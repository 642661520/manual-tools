// 用户管理路由（admin only）
import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { getDb } from '../db/index.js'
import { v4 as uuid } from 'uuid'
import { validatePassword } from '../lib/password.js'
import { notifyRoleChange } from '../services/notifications.js'
import { recordAudit } from '../services/audit.js'
import { success, ok, created, fail } from '../lib/response.js'
import { parsePagination, paginatedQuery } from '../lib/pagination.js'

export async function userRoutes(app: FastifyInstance) {
  // 用户列表（分页）
  app.get('/api/v1/auth/users', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    const { limit, offset } = parsePagination(req.query as Record<string, string>, { limit: 50 })
    const baseSql =
      'SELECT id, username, display_name, role, feishu_open_id, feishu_name, feishu_avatar_url, created_at FROM users ORDER BY created_at'
    const result = paginatedQuery(db, baseSql, 'SELECT COUNT(*) as cnt FROM users', [], {
      limit,
      offset,
    })
    return success(result)
  })

  // 创建用户
  app.post(
    '/api/v1/auth/users',
    { preHandler: [authMiddleware, requireRole('admin')] },
    async (req, reply) => {
      const { username, displayName, password, role } = req.body as {
        username: string
        displayName: string
        password: string
        role: string
      }
      if (!username || !username.trim()) return fail(reply, 400, '用户名不能为空')

      const passwordError = validatePassword(password)
      if (passwordError) {
        return fail(reply, 400, passwordError)
      }
      const db = getDb()
      const id = uuid()
      const hashed = bcrypt.hashSync(password, 10)
      db.prepare(
        'INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      ).run(id, username, displayName || username, hashed, role || 'member')

      // 新创建的 member 用户自动加入默认项目（只读）
      const finalRole = role || 'member'
      if (finalRole === 'member') {
        db.prepare(
          'INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
        ).run('default', id, 'viewer')
      }

      recordAudit({
        userId: req.user!.userId,
        username: req.user?.username || '',
        action: 'user.create',
        targetType: 'user',
        targetId: id,
        detail: { username, displayName, role: finalRole },
      })

      return created(id)
    },
  )

  // 删除用户
  app.delete(
    '/api/v1/auth/users/:id',
    { preHandler: [authMiddleware, requireRole('admin')] },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      if (id === req.user!.userId) return fail(reply, 403, '不能删除自己的账号')
      if (id === 'seed-admin-001') return fail(reply, 403, '内置管理员账号不可删除')
      const db = getDb()
      const existing = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id) as
        | { id: string; username: string }
        | undefined
      if (!existing) return fail(reply, 404, '用户不存在')
      db.prepare('DELETE FROM users WHERE id = ?').run(id)

      recordAudit({
        userId: req.user!.userId,
        username: req.user?.username || '',
        action: 'user.delete',
        targetType: 'user',
        targetId: id,
        detail: { deletedUser: existing.username },
      })

      return ok()
    },
  )

  // 修改用户角色
  app.put(
    '/api/v1/auth/users/:id/role',
    { preHandler: [authMiddleware, requireRole('admin')] },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const { role } = req.body as { role?: string }
      if (!role || !['admin', 'member', 'guest'].includes(role)) {
        return fail(reply, 400, '无效的角色')
      }
      const db = getDb()
      const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as
        | { id: string; role: string }
        | undefined
      if (!existing) return fail(reply, 404, '用户不存在')
      const oldRole = existing.role
      db.prepare('UPDATE users SET role = ?, token_version = token_version + 1 WHERE id = ?').run(
        role,
        id,
      )

      // 角色变更为 member 时自动加入默认项目（只读）
      if (role === 'member') {
        db.prepare(
          'INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
        ).run('default', id, 'viewer')
      }

      recordAudit({
        userId: req.user!.userId,
        username: req.user?.username || '',
        action: 'user.role_change',
        targetType: 'user',
        targetId: id,
        detail: { oldRole, newRole: role },
      })

      const operator = db
        .prepare('SELECT display_name, username FROM users WHERE id = ?')
        .get(req.user!.userId) as { display_name: string; username: string } | undefined
      notifyRoleChange(
        id,
        oldRole,
        role,
        operator?.display_name || operator?.username || '未知用户',
      ).catch((e: unknown) =>
        app.log.error(`飞书通知失败(角色变更): ${e instanceof Error ? e.message : e}`),
      )

      return ok()
    },
  )
}
