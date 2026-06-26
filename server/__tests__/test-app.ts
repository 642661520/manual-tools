/**
 * 集成测试辅助：构建最小 Fastify 实例，使用 app.inject() 而不启动端口监听
 */
import Fastify from 'fastify'
import { initDatabase } from '../db/index.js'
import { authRoutes } from '../routes/auth.js'
import { userRoutes } from '../routes/users.js'
import { projectRoutes } from '../routes/projects.js'
import { getDb } from '../db/index.js'

/** 构建测试用 Fastify 实例（不监听端口） */
export async function buildTestApp() {
  // 确保 DB 初始化
  initDatabase()

  const app = Fastify({ logger: false })

  // 注册必要的插件（cors 在生产路由中可能被引用处需要，但 inject 测试不需要）
  await app.register(authRoutes)
  await app.register(userRoutes)
  await app.register(projectRoutes)

  await app.ready()
  return app
}

/** 清理测试数据 */
export function cleanupTestData(db: ReturnType<typeof getDb>, prefix: string) {
  const like = `%__test_${prefix}%`
  db.prepare('DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE name LIKE ?)').run(like)
  db.prepare('DELETE FROM projects WHERE name LIKE ?').run(like)
  db.prepare('DELETE FROM users WHERE username LIKE ?').run(like)
}
