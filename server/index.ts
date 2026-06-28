import 'dotenv/config'
import './lib/win-encoding.js'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import { initDatabase } from './db/index.js'
import { seedManualIfNeeded } from './db/seed-manual/index.js'
import { config } from './config.js'
import { getLogger } from './lib/logger.js'
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
import { auditRoutes } from './routes/audit.js'
import { searchRoutes } from './routes/search.js'
import { aiRoutes } from './routes/ai.js'
import { diffRoutes } from './routes/diff.js'
import { logRoutes } from './routes/log.js'
import { cleanExpiredRemoteCache } from './services/remote-cache.js'
import { cleanExpiredExportCache } from './services/export-cache.js'
import { rebuildProjectIndex } from './services/search.js'
import { verifyToken } from './auth/jwt.js'
import { authMiddleware, requireRole } from './auth/middleware.js'
import { getDb } from './db/index.js'
import { isProjectMember } from './auth/membership.js'
import { csrfMiddleware } from './lib/csrf.js'
import { extractToken } from './auth/token.js'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'

const PORT = config.port

/** 从请求中提取已认证用户，未登录返回 null */
function extractDocUser(
  req: FastifyRequest | { headers: Record<string, string | string[] | undefined> },
  conn: ReturnType<typeof getDb>,
): { userId: string; role: string } | null {
  const token = extractToken(req)
  if (!token) return null

  try {
    const payload = verifyToken(token)
    const user = conn
      .prepare('SELECT token_version FROM users WHERE id = ?')
      .get(payload.userId) as { token_version: number } | undefined
    if (!user || user.token_version !== payload.tokenVersion) return null
    return { userId: payload.userId, role: payload.role }
  } catch {
    return null
  }
}

/** 根据用户身份返回可见的 visibility 集合 */
function getAllowedVisibilities(
  user: { userId: string; role: string } | null,
  projectId: string,
): Set<string> {
  if (!user) return new Set(['public'])
  // admin 和项目成员可见所有版本
  if (user.role === 'admin' || isProjectMember(user.userId, user.role, projectId)) {
    return new Set(['public', 'login_required', 'project_members'])
  }
  // 已登录但非项目成员
  return new Set(['public', 'login_required'])
}

async function main() {
  const app = Fastify({
    loggerInstance: getLogger(),
    genReqId: () => randomUUID(),
    bodyLimit: 500 * 1024 * 1024,
  })

  // CORS：开发 + 多域名白名单，同源/curl 请求放行
  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = [
        'http://localhost:5173',
        `http://localhost:${config.port}`,
        ...config.corsOrigin
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
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

  // CSRF 保护：对所有状态变更请求验证 X-CSRF-Token
  app.addHook('onRequest', csrfMiddleware)

  // 为请求级日志注入用户上下文
  app.addHook('onRequest', async (req) => {
    const conn = getDb()
    const token = extractToken(req)
    if (token) {
      try {
        const payload = verifyToken(token)
        const user = conn
          .prepare('SELECT token_version FROM users WHERE id = ?')
          .get(payload.userId) as { token_version: number } | undefined
        if (user && user.token_version === payload.tokenVersion) {
          ;(req as unknown as Record<string, unknown>)._userId = payload.userId
          ;(req as unknown as Record<string, unknown>)._userRole = payload.role
        }
      } catch {
        /* token 无效，不注入用户上下文 */
      }
    }
  })

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

  // 种子平台操作手册数据到默认项目
  await seedManualIfNeeded()

  // 启动时清理过期缓存
  cleanExpiredRemoteCache()
  cleanExpiredExportCache()

  // 重建所有项目的搜索索引
  try {
    const db = getDb()
    const projects = db.prepare('SELECT id FROM projects').all() as { id: string }[]
    for (const p of projects) {
      rebuildProjectIndex(p.id)
    }
    app.log.info({ count: projects.length }, 'search index rebuilt')
  } catch (e) {
    app.log.error({ err: e }, '搜索索引重建失败')
  }

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

  // /docs/{catalogId} → /docs/{catalogId}/ （目录缺少尾部斜杠时重定向）
  app.addHook('onRequest', async (req, reply) => {
    const m = req.url.match(/^\/docs\/([^/]+)$/)
    if (m) {
      return reply.redirect(`/docs/${m[1]}/`, 301)
    }
  })

  // 自动为路由分配 Swagger tag（按 URL 前缀），避免大量 "default" 分组
  app.addHook('onRoute', (routeOptions) => {
    const schema = (routeOptions.schema as Record<string, unknown> | undefined) || {}
    if (schema.tags) return // 已有显式 tag，不覆盖

    const url = routeOptions.url
    const tagMap: Record<string, string> = {
      '/api/v1/projects': 'projects',
      '/api/v1/categories': 'categories',
      '/api/v1/features': 'features',
      '/api/v1/catalogs': 'catalogs',
      '/api/v1/auth': 'auth',
      '/api/v1/users': 'users',
      '/api/v1/profile': 'profile',
      '/api/v1/todos': 'todos',
      '/api/v1/upload': 'upload',
      '/api/v1/data-tasks': 'data-tasks',
      '/api/v1/search': 'search',
      '/api/v1/ai': 'ai',
      '/api/v1/diff': 'diff',
      '/api/v1/audit': 'audit',
      '/api/v1/logs': 'log',
      '/api/v1/cache': 'cache',
      '/ws': 'yjs',
      '/docs': 'docs',
    }

    for (const [prefix, tag] of Object.entries(tagMap)) {
      if (url.startsWith(prefix)) {
        ;(routeOptions.schema as Record<string, unknown>) = { ...schema, tags: [tag] }
        return
      }
    }
  })

  // 健康检查
  app.get(
    '/api/health',
    {
      schema: {
        tags: ['health'],
        description: '服务健康检查',
        response: { 200: { type: 'object', properties: { status: { type: 'string' } } } },
      },
    },
    async () => ({ status: 'ok' }),
  )

  // Swagger / OpenAPI 文档 — 必须在路由之前注册，否则收集不到 schema
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: '操作手册编写平台 API',
        description: '多项目操作手册编写与发布平台 RESTful API 文档',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${config.port}`, description: '本地开发服务器' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      tags: [
        { name: 'auth', description: '认证 — 登录 / 注册' },
        { name: 'projects', description: '项目管理' },
        { name: 'categories', description: '分类管理' },
        { name: 'features', description: '功能骨架管理' },
        { name: 'catalogs', description: '目录编排 + 发布' },
        { name: 'users', description: '用户管理' },
        { name: 'profile', description: '个人资料' },
        { name: 'todos', description: '待办汇总' },
        { name: 'upload', description: '文件上传' },
        { name: 'data-tasks', description: '数据导入导出' },
        { name: 'search', description: '全文搜索' },
        { name: 'ai', description: 'AI 写作助手' },
        { name: 'diff', description: '版本对比' },
        { name: 'audit', description: '审计日志' },
      ],
    },
  })

  // Swagger UI — 仅管理员可访问
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', authMiddleware)
    scoped.addHook('preHandler', requireRole('admin'))

    await scoped.register(fastifySwaggerUi, {
      routePrefix: '/docs/api',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        persistAuthorization: true,
      },
    })
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

  // 审计日志路由
  await app.register(auditRoutes)

  // 全文搜索路由
  await app.register(searchRoutes)

  // AI 辅助写作路由
  await app.register(aiRoutes)

  // 版本对比路由
  await app.register(diffRoutes)

  // 前端日志上报路由
  await app.register(logRoutes)

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
    const ver = conn
      .prepare(
        'SELECT cv.visibility, cv.catalog_id, c.project_id FROM catalog_versions cv JOIN catalogs c ON c.id = cv.catalog_id WHERE cv.catalog_id = ? AND cv.version_major = ? AND cv.version_minor = ?',
      )
      .get(catalogId, major, minor) as
      | { visibility: string; catalog_id: string; project_id: string }
      | undefined

    if (!ver) {
      return reply.status(404).send('版本不存在')
    }

    // public: 任何人可看
    if (ver.visibility === 'public') return

    // 需要登录：提取 token（统一用 extractToken）
    const token = extractToken(req)
    let payload: { userId: string; role: string; tokenVersion: number } | null = null
    if (token) {
      try {
        payload = verifyToken(token)
        // 校验 token_version：登出后会递增，旧 token 失效
        const user = conn
          .prepare('SELECT token_version FROM users WHERE id = ?')
          .get(payload.userId) as { token_version: number } | undefined
        if (!user || user.token_version !== payload.tokenVersion) {
          payload = null
        }
      } catch {
        /* token 无效 */
      }
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
    const catalogProject = conn
      .prepare('SELECT project_id FROM catalogs WHERE id = ?')
      .get(catalogId) as { project_id: string } | undefined
    const projectId = catalogProject?.project_id || catalogId
    const allowedVis = getAllowedVisibilities(user, projectId)

    // 查询所有版本，按版本号降序
    const allVersions = conn
      .prepare(
        'SELECT version_major, version_minor, title, change_notes, visibility, created_at FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major DESC, version_minor DESC',
      )
      .all(catalogId) as Array<{
      version_major: number
      version_minor: number
      title: string
      change_notes: string
      visibility: string
      created_at: string
    }>

    // 按权限过滤
    const visible = allVersions.filter((v) => allowedVis.has(v.visibility))

    return reply.send(visible)
  })

  // 文档站点：latest → 302 跳转到最新可见版本
  async function latestHandler(
    req: FastifyRequest<{ Params: { catalogId: string } }>,
    reply: FastifyReply,
  ) {
    const { catalogId } = req.params
    const conn = getDb()

    const user = extractDocUser(req, conn)
    const catalogProject = conn
      .prepare('SELECT project_id FROM catalogs WHERE id = ?')
      .get(catalogId) as { project_id: string } | undefined
    const projectId = catalogProject?.project_id || catalogId
    const allowedVis = getAllowedVisibilities(user, projectId)

    const allVersions = conn
      .prepare(
        'SELECT version_major, version_minor, visibility FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major DESC, version_minor DESC',
      )
      .all(catalogId) as Array<{ version_major: number; version_minor: number; visibility: string }>

    const latest = allVersions.find((v) => allowedVis.has(v.visibility))
    if (!latest) {
      return reply.status(404).send('没有可访问的版本')
    }

    const target = `/docs/${catalogId}/v${latest.version_major}.${latest.version_minor}/`
    return reply.redirect(target)
  }
  app.get('/docs/:catalogId/latest', latestHandler)
  app.get('/docs/:catalogId/latest/', latestHandler)

  // 全局错误处理
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'unhandled error')
    const statusCode = (error as { statusCode?: number }).statusCode || reply.statusCode || 500
    if (statusCode >= 500) {
      return reply.status(500).send({ ok: false, error: '服务器内部错误' })
    }
    return reply
      .status(statusCode)
      .send({ ok: false, error: (error as Error).message || '未知错误' })
  })

  // 请求完成日志
  app.addHook('onResponse', (req, reply, done) => {
    const meta = req as unknown as Record<string, unknown>
    req.log.info(
      {
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
        userId: meta._userId || 'anonymous',
        responseTime: reply.elapsedTime,
      },
      'request completed',
    )
    done()
  })

  // tsx watch 重启时旧进程可能尚未释放端口，重试最多 5 次
  const maxRetries = 5
  for (let retry = 0; retry <= maxRetries; retry++) {
    try {
      await app.listen({ port: PORT, host: '0.0.0.0' })
      app.log.info({ port: PORT }, 'server started')
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE' || retry === maxRetries) {
        app.log.error({ err }, 'server start failed')
        process.exit(1)
      }
      app.log.warn({ port: PORT, retry: retry + 1 }, '端口被占用，1 秒后重试')
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

main()
