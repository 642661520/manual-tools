// 当前用户资料路由：个人信息、通知偏好、修改密码
import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { signToken } from '../auth/jwt.js'
import { authMiddleware } from '../auth/middleware.js'
import { getDb } from '../db/index.js'
import { validatePassword } from '../lib/password.js'
import { success, ok, fail } from '../lib/response.js'

export async function profileRoutes(app: FastifyInstance) {
  // 获取当前用户信息（含 hasPassword + 通知偏好）
  app.get('/api/v1/auth/me', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    const row = db.prepare('SELECT password_hash, notify_enabled, notify_prefs, username_changed FROM users WHERE id = ?').get(req.user!.userId) as { password_hash: string | null; notify_enabled: number; notify_prefs: string; username_changed: number } | undefined
    return success({
      user: {
        ...req.user,
        hasPassword: row ? row.password_hash !== null && row.password_hash !== '' : false,
        notifyEnabled: row ? !!row.notify_enabled : true,
        notifyPrefs: (() => {
          try { return JSON.parse(row?.notify_prefs || '{}') }
          catch { return {} }
        })(),
        usernameChanged: row ? !!row.username_changed : false,
      },
    })
  })

  // 修改显示名称
  app.put('/api/v1/auth/me', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as Record<string, unknown>
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined

    if (!displayName) {
      return fail(reply, 400, '显示名称不能为空')
    }
    if (displayName.length > 64) {
      return fail(reply, 400, '显示名称不能超过64个字符')
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

    return success({ token, displayName })
  })

  // 修改用户名（仅飞书注册用户首次可修改）
  app.put('/api/v1/auth/me/username', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as Record<string, unknown>
    const newUsername = typeof body.username === 'string' ? body.username.trim() : undefined

    if (!newUsername) {
      return fail(reply, 400, '用户名不能为空')
    }
    if (newUsername.length < 3) {
      return fail(reply, 400, '用户名不能少于3个字符')
    }
    if (newUsername.length > 32) {
      return fail(reply, 400, '用户名不能超过32个字符')
    }
    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      return fail(reply, 400, '用户名只能包含字母、数字和下划线')
    }

    const db = getDb()
    const userId = req.user!.userId

    const user = db.prepare('SELECT feishu_open_id, username_changed, token_version FROM users WHERE id = ?').get(userId) as { feishu_open_id: string | null; username_changed: number; token_version: number } | undefined
    if (!user) {
      return fail(reply, 404, '用户不存在')
    }

    if (!user.feishu_open_id) {
      return fail(reply, 403, '非飞书注册用户不允许修改用户名')
    }
    if (user.username_changed) {
      return fail(reply, 403, '用户名仅允许修改一次，您已修改过')
    }

    // 检查用户名是否已被其他用户使用
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newUsername, userId)
    if (existing) {
      return fail(reply, 409, '用户名已被使用')
    }

    const newVersion = user.token_version + 1
    db.prepare('UPDATE users SET username = ?, username_changed = 1, token_version = ? WHERE id = ?').run(newUsername, newVersion, userId)

    const token = signToken({
      userId: req.user!.userId,
      username: newUsername,
      displayName: req.user!.displayName,
      role: req.user!.role,
      tokenVersion: newVersion,
      avatarUrl: req.user!.avatarUrl,
      feishuName: req.user!.feishuName,
    })

    return success({ token, username: newUsername })
  })

  // 更新通知偏好
  app.put('/api/v1/auth/me/notify', { preHandler: authMiddleware }, async (req) => {
    const body = req.body as Record<string, unknown>
    const db = getDb()
    const userId = req.user!.userId

    if (typeof body.notifyEnabled === 'number') {
      db.prepare('UPDATE users SET notify_enabled = ? WHERE id = ?').run(body.notifyEnabled ? 1 : 0, userId)
    }
    if (typeof body.notifyPrefs === 'object' && body.notifyPrefs) {
      db.prepare('UPDATE users SET notify_prefs = ? WHERE id = ?').run(JSON.stringify(body.notifyPrefs), userId)
    }

    return ok()
  })

  // 修改密码
  app.put('/api/v1/auth/me/password', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as Record<string, unknown>
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : undefined
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : undefined

    if (!newPassword) {
      return fail(reply, 400, '请输入新密码')
    }
    const passwordError = validatePassword(newPassword)
    if (passwordError) {
      return fail(reply, 400, passwordError)
    }

    const db = getDb()
    const userId = req.user!.userId

    const user = db.prepare('SELECT password_hash, token_version FROM users WHERE id = ?').get(userId) as { password_hash: string | null; token_version: number } | undefined
    if (!user) {
      return fail(reply, 404, '用户不存在')
    }

    const hasExistingPassword = user.password_hash !== null && user.password_hash !== ''
    if (hasExistingPassword) {
      if (!currentPassword || typeof currentPassword !== 'string') {
        return fail(reply, 400, '请输入当前密码')
      }
      const currentMatch = bcrypt.compareSync(currentPassword, user.password_hash!)
      if (!currentMatch) {
        return fail(reply, 400, '当前密码不正确')
      }
    }

    const hashed = bcrypt.hashSync(newPassword, 10)
    const newVersion = user.token_version + 1
    db.prepare('UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?').run(hashed, newVersion, userId)

    const token = signToken({
      userId: req.user!.userId,
      username: req.user!.username,
      displayName: req.user!.displayName,
      role: req.user!.role,
      tokenVersion: newVersion,
      avatarUrl: req.user!.avatarUrl,
      feishuName: req.user!.feishuName,
    })

    return success({ token })
  })
}