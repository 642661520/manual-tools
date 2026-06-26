// 用户管理路由（admin only）
import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { getDb } from '../db/index.js'
import { v4 as uuid } from 'uuid'
import { validatePassword } from '../lib/password.js'
import { notifyRoleChange } from '../services/notifications.js'
import { success, ok, created, fail } from '../lib/response.js'

export async function userRoutes(app: FastifyInstance) {
  // 用户列表
  app.get('/api/v1/auth/users', { preHandler: authMiddleware }, async () => {
    const db = getDb()
    const rows = db.prepare('SELECT id, username, display_name, role, feishu_open_id, feishu_name, feishu_avatar_url, created_at FROM users ORDER BY created_at').all()
    return success(rows)
  })

  // 创建用户
  app.post('/api/v1/auth/users', { preHandler: [authMiddleware, requireRole('admin')] }, async (req, reply) => {
    const { username, displayName, password, role } = req.body as { username: string; displayName: string; password: string; role: string }
    if (!username || !username.trim()) return fail(reply, 400, '用户名不能为空')

    const passwordError = validatePassword(password)
    if (passwordError) {
      return fail(reply, 400, passwordError)
    }
    const db = getDb()
    const id = uuid()
    const hashed = bcrypt.hashSync(password, 10)
    db.prepare('INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
      id, username, displayName || username, hashed, role || 'member',
    )
    return created(id)
  })

  // 删除用户
  app.delete('/api/v1/auth/users/:id', { preHandler: [authMiddleware, requireRole('admin')] }, async (req) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    return ok()
  })

  // 修改用户角色
  app.put('/api/v1/auth/users/:id/role', { preHandler: [authMiddleware, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { role } = req.body as { role?: string }
    if (!role || !['admin', 'member', 'guest'].includes(role)) {
      return fail(reply, 400, '无效的角色')
    }
    const db = getDb()
    const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: string; role: string } | undefined
    if (!existing) return fail(reply, 404, '用户不存在')
    const oldRole = existing.role
    db.prepare('UPDATE users SET role = ?, token_version = token_version + 1 WHERE id = ?').run(role, id)

    const operator = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user!.userId) as { display_name: string } | undefined
    notifyRoleChange(id, oldRole, role, operator?.display_name || '系统管理员')
      .catch((e: unknown) => app.log.error(`飞书通知失败(角色变更): ${e instanceof Error ? e.message : e}`))

    return ok()
  })
}