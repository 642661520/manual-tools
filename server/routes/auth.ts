import { FastifyInstance } from 'fastify'
import { signToken } from '../auth/jwt.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { getDb } from '../db/index.js'
import { v4 as uuid } from 'uuid'
import type { UserRow, CreateUserBody } from '../types.js'
import { getFeishuAuthUrl, exchangeCodeForToken } from '../services/feishu.js'
import { determineRole } from '../auth/feishu.js'
import { notifyNewGuest, notifyRoleChange } from '../services/notifications.js'

interface LoginBody {
  username: string
  password: string
}

/**
 * 校验密码强度和长度（3/4 规则：大写、小写、数字、特殊字符中至少满足3种）
 * 返回 null 表示通过，返回字符串为错误消息
 */
function validatePassword(password: unknown): string | null {
  if (!password || typeof password !== 'string') {
    return '请输入密码'
  }
  if (password.length < 8) {
    return '密码不能少于8位'
  }
  if (password.length > 128) {
    return '密码不能超过128位'
  }

  let categories = 0
  if (/[A-Z]/.test(password)) categories++
  if (/[a-z]/.test(password)) categories++
  if (/[0-9]/.test(password)) categories++
  if (/[^A-Za-z0-9]/.test(password)) categories++

  if (categories < 3) {
    return '密码需包含大写字母、小写字母、数字、特殊字符中至少3种'
  }

  return null
}

export async function authRoutes(app: FastifyInstance) {
  // 登录
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body as LoginBody

    if (!username || !password) {
      return reply.status(400).send({ error: '请输入用户名和密码' })
    }
    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
    if (!user) {
      return reply.status(401).send({ error: '用户名或密码错误' })
    }
    if (password !== user.password_hash) {
      return reply.status(401).send({ error: '用户名或密码错误' })
    }
    const token = signToken({
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role as 'pm' | 'ops' | 'guest',
      tokenVersion: user.token_version,
      avatarUrl: user.feishu_avatar_url || undefined,
      feishuName: user.feishu_name || undefined,
    })
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        avatarUrl: user.feishu_avatar_url || '',
        feishuName: user.feishu_name || '',
      },
    }
  })

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

  // 修改个人信息（显示名称）
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

    // 签发新令牌（排除旧令牌的 exp/iat，由 signToken 重新生成）
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

    // 查询当前用户密码状态
    const user = db.prepare('SELECT password_hash, token_version FROM users WHERE id = ?').get(userId) as { password_hash: string | null; token_version: number } | undefined
    if (!user) {
      return reply.status(404).send({ error: '用户不存在' })
    }

    // 已有密码的用户：必须验证当前密码
    const hasExistingPassword = user.password_hash !== null && user.password_hash !== ''
    if (hasExistingPassword) {
      if (!currentPassword || typeof currentPassword !== 'string') {
        return reply.status(400).send({ error: '请输入当前密码' })
      }
      if (currentPassword !== user.password_hash) {
        return reply.status(400).send({ error: '当前密码不正确' })
      }
    }

    // 更新密码并递增 token_version（强制其他设备下线）
    const newVersion = user.token_version + 1
    db.prepare('UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?').run(newPassword, newVersion, userId)

    // 签发新令牌（排除旧令牌的 exp/iat，由 signToken 重新生成）
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

  // 用户管理
  app.get('/api/auth/users', { preHandler: authMiddleware }, async () => {
    const db = getDb()
    return db.prepare('SELECT id, username, display_name, role, feishu_open_id, feishu_name, feishu_avatar_url, created_at FROM users ORDER BY created_at').all()
  })

  app.post('/api/auth/users', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { username, displayName, password, role } = req.body as CreateUserBody
    if (!username || !username.trim()) return reply.status(400).send({ error: '用户名不能为空' })

    const passwordError = validatePassword(password)
    if (passwordError) {
      return reply.status(400).send({ error: passwordError })
    }
    const db = getDb()
    const id = uuid()
    db.prepare('INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
      id, username, displayName || username, password, role || 'ops',
    )
    return { id }
  })

  app.delete('/api/auth/users/:id', { preHandler: [authMiddleware, requireRole('pm')] }, async (req) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    return { ok: true }
  })

  // ---- 飞书账号绑定 ----

  // 生成绑定 OAuth URL
  app.get('/api/auth/feishu/bind-url', { preHandler: authMiddleware }, async (req) => {
    const userId = req.user!.userId
    const random = Math.random().toString(36).slice(2, 8)
    const state = `${userId}:${random}`
    const url = getFeishuAuthUrl(state)
    return { url }
  })

  // 完成飞书绑定（用 code 换 open_id）
  app.put('/api/auth/me/feishu-binding', { preHandler: authMiddleware }, async (req, reply) => {
    const { code } = req.body as { code?: string }
    if (!code) return reply.status(400).send({ error: '缺少授权码' })

    const db = getDb()
    const userId = req.user!.userId

    try {
      const info = await exchangeCodeForToken(code)
      if (!info.open_id) return reply.status(400).send({ error: '获取飞书用户信息失败' })

      // 检查 open_id 是否已被其他用户绑定
      const existing = db.prepare(
        'SELECT id FROM users WHERE feishu_open_id = ? AND id != ?',
      ).get(info.open_id, userId) as { id: string } | undefined

      if (existing) {
        return reply.status(409).send({ error: '该飞书账号已被其他用户绑定' })
      }

      db.prepare('UPDATE users SET display_name = ?, feishu_open_id = ?, feishu_name = ?, feishu_avatar_url = ? WHERE id = ?').run(
        info.name, info.open_id, info.name, info.avatar_url || null, userId,
      )

      return {
        openId: info.open_id,
        name: info.name,
        avatarUrl: info.avatar_url || '',
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '飞书授权失败'
      return reply.status(500).send({ error: msg })
    }
  })

  // 查询当前用户绑定状态
  app.get('/api/auth/me/feishu-binding', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    const user = db.prepare('SELECT feishu_open_id, feishu_name, feishu_avatar_url FROM users WHERE id = ?').get(req.user!.userId) as { feishu_open_id: string | null; feishu_name: string | null; feishu_avatar_url: string | null } | undefined

    if (!user?.feishu_open_id) {
      return { bound: false }
    }

    return {
      bound: true,
      openId: user.feishu_open_id,
      name: user.feishu_name || '',
      avatarUrl: user.feishu_avatar_url || '',
    }
  })

  // 解除飞书绑定
  app.delete('/api/auth/me/feishu-binding', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    db.prepare('UPDATE users SET feishu_open_id = NULL, feishu_name = NULL, feishu_avatar_url = NULL WHERE id = ?').run(req.user!.userId)
    return { ok: true }
  })

  // ---- 飞书登录 ----

  app.get('/api/auth/feishu/login-url', async (_req, reply) => {
    const random = Math.random().toString(36).slice(2, 8)
    const state = `login:${random}`
    try {
      const url = getFeishuAuthUrl(state)
      return { url }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '飞书登录未配置'
      return reply.status(500).send({ error: msg })
    }
  })

  app.post('/api/auth/feishu/login', async (req, reply) => {
    const { code } = req.body as { code?: string }
    if (!code) return reply.status(400).send({ error: '缺少授权码' })

    const db = getDb()

    try {
      const info = await exchangeCodeForToken(code)
      if (!info.open_id) return reply.status(400).send({ error: '获取飞书用户信息失败' })

      // 查找已有用户
      let user = db.prepare('SELECT * FROM users WHERE feishu_open_id = ?').get(info.open_id) as UserRow | undefined

      if (!user) {
        // 首次登录，自动创建游客账号
        const id = uuid()
        const role = determineRole(info.open_id)
        const username = `feishu_${info.open_id.slice(0, 12)}`
        db.prepare(
          'INSERT INTO users (id, username, display_name, password_hash, role, feishu_open_id, feishu_name, feishu_avatar_url) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
        ).run(id, username, info.name, role, info.open_id, info.name, info.avatar_url || null)

        user = {
          id,
          username,
          display_name: info.name,
          password_hash: null,
          role,
          token_version: 0,
          feishu_open_id: info.open_id,
          feishu_name: info.name,
          feishu_avatar_url: info.avatar_url || null,
          created_at: new Date().toISOString(),
        }
      } else {
        // 更新飞书信息（含 display_name，确保显示最新昵称）
        db.prepare('UPDATE users SET display_name = ?, feishu_name = ?, feishu_avatar_url = ? WHERE id = ?').run(
          info.name, info.name, info.avatar_url || null, user.id,
        )
      }

      // 新用户通知 PM
      if (user.role === 'guest') {
        notifyNewGuest(user.display_name).catch(e => console.error('通知新成员失败:', e))
      }

      const token = signToken({
        userId: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role as 'pm' | 'ops' | 'guest',
        tokenVersion: user.token_version,
        avatarUrl: user.feishu_avatar_url || undefined,
        feishuName: user.feishu_name || undefined,
      })

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          avatarUrl: user.feishu_avatar_url || '',
          feishuName: user.feishu_name || '',
        },
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '飞书登录失败'
      return reply.status(500).send({ error: msg })
    }
  })

  // 管理员修改用户角色
  app.put('/api/auth/users/:id/role', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { role } = req.body as { role?: string }
    if (!role || !['pm', 'ops', 'guest'].includes(role)) {
      return reply.status(400).send({ error: '无效的角色' })
    }
    const db = getDb()
    const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: string; role: string } | undefined
    if (!existing) return reply.status(404).send({ error: '用户不存在' })
    const oldRole = existing.role
    db.prepare('UPDATE users SET role = ?, token_version = token_version + 1 WHERE id = ?').run(role, id)

    // 通知被变更的用户
    const operator = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user!.userId) as { display_name: string } | undefined
    notifyRoleChange(id, oldRole, role, operator?.display_name || '管理员')
      .catch(e => console.error('飞书通知失败(角色变更):', e))

    return { ok: true }
  })
}
