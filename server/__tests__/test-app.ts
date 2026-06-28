/**
 * 集成测试辅助：构建最小 Fastify 实例，使用 app.inject() 而不启动端口监听
 */
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { initDatabase } from '../db/index.js'
import { authRoutes } from '../routes/auth.js'
import { userRoutes } from '../routes/users.js'
import { projectRoutes } from '../routes/projects.js'
import { featureRoutes } from '../routes/features.js'
import { catalogRoutes } from '../routes/catalogs.js'
import { categoryRoutes } from '../routes/categories.js'
import { uploadRoutes } from '../routes/upload.js'
import { searchRoutes } from '../routes/search.js'
import { todoRoutes } from '../routes/todos.js'
import { profileRoutes } from '../routes/profile.js'
import { diffRoutes } from '../routes/diff.js'
import { auditRoutes } from '../routes/audit.js'
import { logRoutes } from '../routes/log.js'
import { aiRoutes } from '../routes/ai.js'
import { dataTaskRoutes } from '../routes/data-tasks.js'
import { feishuRoutes } from '../routes/feishu.js'
import { cacheRoutes } from '../routes/cache.js'
import { yjsRoutes } from '../routes/yjs.js'
import websocket from '@fastify/websocket'
import { getDb } from '../db/index.js'

/** 构建测试用 Fastify 实例（不监听端口） */
export async function buildTestApp() {
  initDatabase()

  const app = Fastify({ logger: false })

  await app.register(cors, { origin: true })
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } })
  await app.register(authRoutes)
  await app.register(userRoutes)
  await app.register(projectRoutes)
  await app.register(featureRoutes)
  await app.register(catalogRoutes)
  await app.register(categoryRoutes)
  await app.register(uploadRoutes)
  await app.register(searchRoutes)
  await app.register(todoRoutes)
  await app.register(profileRoutes)
  await app.register(diffRoutes)
  await app.register(auditRoutes)
  await app.register(logRoutes)
  await app.register(aiRoutes)
  await app.register(dataTaskRoutes)
  await app.register(feishuRoutes)
  await app.register(cacheRoutes)
  await app.register(yjsRoutes)

  await app.ready()
  return app
}

/** 构建测试用 Fastify 实例（含 WebSocket，可监听端口） */
export async function buildTestAppWithWs() {
  initDatabase()

  const app = Fastify({ logger: false })

  await app.register(websocket)
  await app.register(cors, { origin: true })
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } })
  await app.register(authRoutes)
  await app.register(userRoutes)
  await app.register(projectRoutes)
  await app.register(featureRoutes)
  await app.register(catalogRoutes)
  await app.register(categoryRoutes)
  await app.register(uploadRoutes)
  await app.register(searchRoutes)
  await app.register(todoRoutes)
  await app.register(profileRoutes)
  await app.register(diffRoutes)
  await app.register(auditRoutes)
  await app.register(logRoutes)
  await app.register(aiRoutes)
  await app.register(dataTaskRoutes)
  await app.register(feishuRoutes)
  await app.register(cacheRoutes)
  await app.register(yjsRoutes)

  await app.ready()
  return app
}

/** 清理测试数据 */
export function cleanupTestData(db: ReturnType<typeof getDb>, prefix: string) {
  const like = `%__test_${prefix}%`
  // 按 FK 依赖顺序删除：子表 → 父表
  db.prepare(
    'DELETE FROM document_updates WHERE document_id IN (SELECT id FROM documents WHERE feature_id IN (SELECT id FROM features WHERE title LIKE ?))',
  ).run(like)
  db.prepare(
    'DELETE FROM document_snapshots WHERE document_id IN (SELECT id FROM documents WHERE feature_id IN (SELECT id FROM features WHERE title LIKE ?))',
  ).run(like)
  db.prepare(
    'DELETE FROM documents WHERE feature_id IN (SELECT id FROM features WHERE title LIKE ?)',
  ).run(like)
  db.prepare(
    'DELETE FROM catalog_versions WHERE catalog_id IN (SELECT id FROM catalogs WHERE title LIKE ?)',
  ).run(like)
  db.prepare('DELETE FROM catalogs WHERE title LIKE ?').run(like)
  db.prepare('DELETE FROM features WHERE title LIKE ?').run(like)
  db.prepare('DELETE FROM categories WHERE name LIKE ?').run(like)
  db.prepare(
    'DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE name LIKE ?)',
  ).run(like)
  db.prepare('DELETE FROM projects WHERE name LIKE ?').run(like)
  db.prepare('DELETE FROM users WHERE username LIKE ?').run(like)
}
