// 当前用户资料路由：个人信息、通知偏好、修改密码
import { FastifyInstance } from 'fastify'
import { signToken } from '../auth/jwt.js'
import { authMiddleware } from '../auth/middleware.js'
import { getDb } from '../db/index.js'
import { validatePassword } from '../lib/password.js'

export async function profileRoutes(app: FastifyInstance) {
  // 获取当前用户信息（含 hasPassword + 通知偏好）
  app.get('/api/auth/me', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    const row = db.prepare('SELECT password_hash, notify_enabled, notify_prefs FROM users WHERE id = ?').get(req.user!.userId) as { password_hash: string | null; notify_enabled: number; notify_prefs: string } | undefined
    return {
      user: {
        ...req.user,
        hasPassword: row ? row.password_hash !== null && row.password_hash !== '' : false,
        notifyEnabled: row ? !!row.notify_enabled : true,
        notifyPrefs: (() => {
          try { return JSON.parse(row?.notify_prefs || '{}') }
          catch { return {} }
        })(),
      },
    }
  })

  // 修改显示名称
  app.put('/api/auth/me', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as Record<string, unknown>
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined

    if (!displayName) {
      return reply.status(400).send({ error: '显示名称不能为空' })
    }
    if (displayName.length > 64) {
      return reply.status(400).send({ error: '显示名称不能超过64个字符' })
    }

    const db = getDb()
    const userId = req.user!.userId

    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, userId)

    const token = signToken({
      userId: req.user!.userId,
      username: req.user!.username,
      displayName,
      role: req.user!.role,
      tokenVersion: req.user!.tokenVersion,
      avatarUrl: req.user!.avatarUrl,
      feishuName: req.user!.feishuName,
    })

    return { ok: true, token, displayName }
  })

  // 更新通知偏好
  app.put('/api/auth/me/notify', { preHandler: authMiddleware }, async (req) => {
    const body = req.body as Record<string, unknown>
    const db = getDb()
    const userId = req.user!.userId

    if (typeof body.notifyEnabled === 'number') {
      db.prepare('UPDATE users SET notify_enabled = ? WHERE id = ?').run(body.notifyEnabled ? 1 : 0, userId)
    }
    if (typeof body.notifyPrefs === 'object' && body.notifyPrefs) {
      db.prepare('UPDATE users SET notify_prefs = ? WHERE id = ?').run(JSON.stringify(body.notifyPrefs), userId)
    }

    return { ok: true }
  })

  // 修改密码
  app.put('/api/auth/me/password', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as Record<string, unknown>
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : undefined
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : undefined

    const passwordError = validatePassword(newPassword)
    if (passwordError) {
      return reply.status(400).send({ error: passwordError })
    }

    const db = getDb()
    const userId = req.user!.userId

    const user = db.prepare('SELECT password_hash, token_version FROM users WHERE id = ?').get(userId) as { password_hash: string | null; token_version: number } | undefined
    if (!user) {
      return reply.status(404).send({ error: '用户不存在' })
    }

    const hasExistingPassword = user.password_hash !== null && user.password_hash !== ''
    if (hasExistingPassword) {
      if (!currentPassword || typeof currentPassword !== 'string') {
        return reply.status(400).send({ error: '请输入当前密码' })
      }
      if (currentPassword !== user.password_hash) {
        return reply.status(400).send({ error: '当前密码不正确' })
      }
    }

    const newVersion = user.token_version + 1
    db.prepare('UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?').run(newPassword, newVersion, userId)

    const token = signToken({
      userId: req.user!.userId,
      username: req.user!.username,
      displayName: req.user!.displayName,
      role: req.user!.role,
      tokenVersion: newVersion,
      avatarUrl: req.user!.avatarUrl,
      feishuName: req.user!.feishuName,
    })

    return { ok: true, token }
  })
}
