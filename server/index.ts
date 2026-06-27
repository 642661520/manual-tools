import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import { initDatabase } from './db/index.js'
import { config } from './config.js'
import { yjsRoutes } from './routes/yjs.js'
import { authRoutes } from './routes/auth.js'
import { profileRoutes } from './routes/profile.js'
import { userRoutes } from './routes/users.js'
import { feishuRoutes as feishuBindRoutes } from './routes/feishu.js'
import { featureRoutes } from './routes/features.js'
import { catalogRoutes } from './routes/catalogs.js'
import { projectRoutes } from './routes/projects.js'
import { categoryRoutes } from './routes/categories.js'
import { dataTaskRoutes } from './routes/data-tasks.js'
import { uploadRoutes } from './routes/upload.js'
import { todoRoutes } from './routes/todos.js'
import { cacheRoutes } from './routes/cache.js'
import { cleanExpiredRemoteCache } from './services/remote-cache.js'
import { cleanExpiredExportCache } from './services/export-cache.js'
import { verifyToken } from './auth/jwt.js'
import { getDb } from './db/index.js'
import { isProjectMember } from './auth/membership.js'

const PORT = config.port

/** 从请求中提取已认证用户，未登录返回 null */
function extractDocUser(req: FastifyRequest | { headers: Record<string, string | string[] | undefined> }, conn: ReturnType<typeof getDb>): { userId: string; role: string } | null {
  let token = ''
  const auth = req.headers.authorization
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    token = auth.slice(7)
  }
  if (!token) {
    const cookies = typeof req.headers.cookie === 'string' ? req.headers.cookie : ''
    const match = cookies.match(/auth_token=([^;]+)/)
    if (match) token = match[1]
  }
  if (!token) return null

  try {
    const payload = verifyToken(token)
    const user = conn.prepare('SELECT token_version FROM users WHERE id = ?').get(payload.userId) as { token_version: number } | undefined
    if (!user || user.token_version !== payload.tokenVersion) return null
    return { userId: payload.userId, role: payload.role }
  } catch {
    return null
  }
}

/** 根据用户身份返回可见的 visibility 集合 */
function getAllowedVisibilities(user: { userId: string; role: string } | null, projectId: string): Set<string> {
  if (!user) return new Set(['public'])
  // admin 和项目成员可见所有版本
  if (user.role === 'admin' || isProjectMember(user.userId, user.role, projectId)) {
    return new Set(['public', 'login_required', 'project_members'])
  }
  // 已登录但非项目成员
  return new Set(['public', 'login_required'])
}

async function main() {
  const app = Fastify({ logger: true, bodyLimit: 500 * 1024 * 1024 })

  // CORS：开发 + 多域名白名单，同源/curl 请求放行
  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = [
        'http://localhost:5173',
        ...config.corsOrigin.split(',').map(s => s.trim()).filter(Boolean),
      ]
      if (!origin || allowed.includes(origin)) {
        cb(null, true)
      } else {
        cb(new Error('Not allowed by CORS'), false)
      }
    },
  })

  // 安全响应头
  await app.register(helmet, { contentSecurityPolicy: false })

  // 全局限速（auth 路由内部可覆盖为更严格限制）
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' })

  await app.register(websocket)
  const uploadLimit = Math.max(config.uploadMaxSize, config.videoMaxSize) * 1024 * 1024
  await app.register(multipart, { limits: { fileSize: uploadLimit } })

  const __dirname = dirname(fileURLToPath(import.meta.url))

  // 静态文件（生产环境服务前端构建产物）
  let needDecorate = true
  if (config.isProduction) {
    const staticModule = await import('@fastify/static')
    await app.register(staticModule.default, {
      root: join(__dirname, '../dist'),
      prefix: '/',
    })
    needDecorate = false

    // SPA fallback：非 API / 非静态文件请求返回 index.html
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/v1/') || request.url.startsWith('/ws/')) {
        return reply.status(404).send({ ok: false, error: 'Not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  // 初始化数据库
  initDatabase()

  // 启动时清理过期缓存
  cleanExpiredRemoteCache()
  cleanExpiredExportCache()

  // 静态托管上传文件
  const staticModule = await import('@fastify/static')
  await app.register(staticModule.default, {
    root: join(__dirname, '../data/uploads'),
    prefix: '/uploads/',
    decorateReply: needDecorate,
  })

  // 静态托管文档站点
  await app.register(staticModule.default, {
    root: join(__dirname, '../data/docs'),
    prefix: '/docs/',
    decorateReply: false,
  })

  // 项目路由
  await app.register(projectRoutes)

  // 分类路由
  await app.register(categoryRoutes)

  // Y.js 协同编辑 WebSocket 路由
  await app.register(yjsRoutes)

  // 认证路由
  await app.register(authRoutes)

  // 个人资料路由
  await app.register(profileRoutes)

  // 用户管理路由
  await app.register(userRoutes)

  // 飞书绑定路由
  await app.register(feishuBindRoutes)

  // 章节骨架路由
  await app.register(featureRoutes)

  // 目录编排路由（含预览和导出）
  await app.register(catalogRoutes)

  // 数据导入导出路由
  await app.register(dataTaskRoutes)

  // 上传路由
  await app.register(uploadRoutes)

  // 待办路由
  await app.register(todoRoutes)

  // 缓存管理路由
  await app.register(cacheRoutes)

  // 文档站点访问控制
  app.addHook('onRequest', async (req, reply) => {
    // 匹配 /docs/{catalogId}/v{major}.{minor}/ 开头的请求
    const match = req.url.match(/^\/docs\/([^/]+)\/(v\d+\.\d+)\//)
    if (!match) return

    const catalogId = match[1]
    const versionLabel = match[2]
    // 解析 v1.0 → { major: 1, minor: 0 }
    const vParts = versionLabel.slice(1).split('.')
    const major = parseInt(vParts[0])
    const minor = parseInt(vParts[1])

    const conn = getDb()
    const ver = conn.prepare(
      'SELECT cv.visibility, cv.catalog_id, c.project_id FROM catalog_versions cv JOIN catalogs c ON c.id = cv.catalog_id WHERE cv.catalog_id = ? AND cv.version_major = ? AND cv.version_minor = ?',
    ).get(catalogId, major, minor) as { visibility: string; catalog_id: string; project_id: string } | undefined

    if (!ver) {
      return reply.status(404).send('版本不存在')
    }

    // public: 任何人可看
    if (ver.visibility === 'public') return

    // 需要登录：先取 token（优先 header，其次 cookie）
    let token = ''
    const auth = req.headers.authorization
    if (auth && auth.startsWith('Bearer ')) {
      token = auth.slice(7)
    }
    if (!token) {
      // 从 cookie 读取
      const cookies = req.headers.cookie || ''
      const match = cookies.match(/auth_token=([^;]+)/)
      if (match) token = match[1]
    }

    let payload: { userId: string; role: string; tokenVersion: number } | null = null
    if (token) {
      try {
        payload = verifyToken(token)
        // 校验 token_version：登出后会递增，旧 token 失效
        const user = conn.prepare('SELECT token_version FROM users WHERE id = ?').get(payload.userId) as { token_version: number } | undefined
        if (!user || user.token_version !== payload.tokenVersion) {
          payload = null
        }
      } catch { /* token 无效 */ }
    }

    if (!payload) {
      // 未登录 → 重定向到登录页，登录后跳回来
      const returnUrl = encodeURIComponent(req.url)
      return reply.redirect(`/login?redirect=${returnUrl}`)
    }

    // login_required: 登录即可
    if (ver.visibility === 'login_required') return

    // project_members (默认): 需是该项目成员
    if (!isProjectMember(payload.userId, payload.role, ver.project_id)) {
      return reply.status(403).send('无权访问此文档')
    }
  })

  // 文档站点 API：获取版本列表（按权限过滤）
  app.get('/docs/:catalogId/versions.json', async (req, reply) => {
    const { catalogId } = req.params as { catalogId: string }
    const conn = getDb()

    // 提取用户身份（同 access control hook 逻辑）
    const user = extractDocUser(req, conn)
    const catalogProject = conn.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(catalogId) as { project_id: string } | undefined
    const projectId = catalogProject?.project_id || catalogId
    const allowedVis = getAllowedVisibilities(user, projectId)

    // 查询所有版本，按版本号降序
    const allVersions = conn.prepare(
      'SELECT version_major, version_minor, title, change_notes, visibility, created_at FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major DESC, version_minor DESC',
    ).all(catalogId) as Array<{
      version_major: number
      version_minor: number
      title: string
      change_notes: string
      visibility: string
      created_at: string
    }>

    // 按权限过滤
    const visible = allVersions.filter(v => allowedVis.has(v.visibility))

    return reply.send(visible)
  })

  // 文档站点：latest → 302 跳转到最新可见版本
  async function latestHandler(req: FastifyRequest<{ Params: { catalogId: string } }>, reply: FastifyReply) {
    const { catalogId } = req.params
    const conn = getDb()

    const user = extractDocUser(req, conn)
    const catalogProject = conn.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(catalogId) as { project_id: string } | undefined
    const projectId = catalogProject?.project_id || catalogId
    const allowedVis = getAllowedVisibilities(user, projectId)

    const allVersions = conn.prepare(
      'SELECT version_major, version_minor, visibility FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major DESC, version_minor DESC',
    ).all(catalogId) as Array<{ version_major: number; version_minor: number; visibility: string }>

    const latest = allVersions.find(v => allowedVis.has(v.visibility))
    if (!latest) {
      return reply.status(404).send('没有可访问的版本')
    }

    const target = `/docs/${catalogId}/v${latest.version_major}.${latest.version_minor}/`
    return reply.redirect(target)
  }
  app.get('/docs/:catalogId/latest', latestHandler)
  app.get('/docs/:catalogId/latest/', latestHandler)

  // 健康检查
  app.get('/api/health', async () => ({ status: 'ok' }))

  // 全局错误处理
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error)
    const statusCode = (error as { statusCode?: number }).statusCode || reply.statusCode || 500
    if (statusCode >= 500) {
      return reply.status(500).send({ ok: false, error: '服务器内部错误' })
    }
    return reply.status(statusCode).send({ ok: false, error: (error as Error).message || '未知错误' })
  })

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`Server running at http://localhost:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
