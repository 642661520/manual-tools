import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import { initDatabase } from './db/index.js'
import { yjsRoutes } from './routes/yjs.js'
import { authRoutes } from './routes/auth.js'
import { featureRoutes } from './routes/features.js'
import { catalogRoutes } from './routes/catalogs.js'
import { projectRoutes } from './routes/projects.js'
import { categoryRoutes } from './routes/categories.js'
import { backupRoutes } from './routes/backup.js'
import { uploadRoutes } from './routes/upload.js'
import { todoRoutes } from './routes/todos.js'

const PORT = parseInt(process.env.PORT || '3000')

async function main() {
  const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 })

  await app.register(cors)
  await app.register(websocket)
  const uploadLimit = parseInt(process.env.UPLOAD_MAX_SIZE || '10') * 1024 * 1024
  await app.register(multipart, { limits: { fileSize: uploadLimit } })

  const __dirname = dirname(fileURLToPath(import.meta.url))

  // 静态文件（生产环境服务前端构建产物）
  let needDecorate = true
  if (process.env.NODE_ENV === 'production') {
    const staticModule = await import('@fastify/static')
    await app.register(staticModule.default, {
      root: join(__dirname, '../dist'),
      prefix: '/',
    })
    needDecorate = false
  }

  // 初始化数据库
  initDatabase()

  // 静态托管上传文件
  const staticModule = await import('@fastify/static')
  await app.register(staticModule.default, {
    root: join(__dirname, '../data/uploads'),
    prefix: '/uploads/',
    decorateReply: needDecorate,
  })

  // 项目路由
  await app.register(projectRoutes)

  // 分类路由
  await app.register(categoryRoutes)

  // Y.js 协同编辑 WebSocket 路由
  await app.register(yjsRoutes)

  // 认证路由
  await app.register(authRoutes)

  // 主题骨架路由
  await app.register(featureRoutes)

  // 目录编排路由（含预览和导出）
  await app.register(catalogRoutes)

  // 备份路由
  await app.register(backupRoutes)

  // 上传路由
  await app.register(uploadRoutes)

  // 待办路由
  await app.register(todoRoutes)

  // 健康检查
  app.get('/api/health', async () => ({ status: 'ok' }))

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`Server running at http://localhost:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
