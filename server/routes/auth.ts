// 认证路由：密码登录 + 飞书登录
import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { signToken } from '../auth/jwt.js'
import { getDb } from '../db/index.js'
import { v4 as uuid } from 'uuid'
import type { UserRow } from '../types.js'
import { getFeishuAuthUrl, exchangeCodeForToken } from '../services/feishu.js'
import { determineRole } from '../auth/feishu.js'
import { notifyNewGuest } from '../services/notifications.js'
import { success, fail } from '../lib/response.js'
import { authMiddleware } from '../auth/middleware.js'

export async function authRoutes(app: FastifyInstance) {
  // 密码登录（严格限速：1分钟最多5次）
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string }

    if (!username || !password) {
      return fail(reply, 400, '请输入用户名和密码')
    }
    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
    if (!user) {
      return fail(reply, 401, '用户名或密码错误')
    }
    if (!user.password_hash) {
      return fail(reply, 401, '该账号未设置密码，请使用飞书登录')
    }

    // bcrypt 比对；存量明文密码兼容：比对失败时回退明文比对并自动升级
    let passwordMatch = false
    try {
      passwordMatch = bcrypt.compareSync(password, user.password_hash)
    } catch {
      // bcrypt.compareSync 对非哈希字符串会抛异常，回退明文比对
    }
    if (!passwordMatch && password === user.password_hash) {
      // 存量明文密码，自动升级为 bcrypt 哈希
      const hashed = bcrypt.hashSync(password, 10)
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashed, user.id)
      passwordMatch = true
    }
    if (!passwordMatch) {
      return fail(reply, 401, '用户名或密码错误')
    }
    const token = signToken({
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role as 'admin' | 'member' | 'guest',
      tokenVersion: user.token_version,
      avatarUrl: user.feishu_avatar_url || undefined,
      feishuName: user.feishu_name || undefined,
    })
    // 设置 cookie，供文档站点页面导航鉴权
    reply.header('Set-Cookie', `auth_token=${token}; Path=/; SameSite=Lax; Max-Age=86400`)
    return success({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        avatarUrl: user.feishu_avatar_url || '',
        feishuName: user.feishu_name || '',
      },
    })
  })

  // 登出：递增 token_version 使所有 JWT 失效
  app.post('/api/v1/auth/logout', { preHandler: authMiddleware }, async (req, reply) => {
    const db = getDb()
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?')
      .run(req.user!.userId)
    return success({ ok: true })
  })

  // 飞书登录 URL
  app.get('/api/v1/auth/feishu/login-url', async (_req, reply) => {
    const random = Math.random().toString(36).slice(2, 8)
    const state = `login:${random}`
    try {
      const url = getFeishuAuthUrl(state)
      return success({ url })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '飞书登录未配置'
      return fail(reply, 500, msg)
    }
  })

  // 飞书登录回调
  app.post('/api/v1/auth/feishu/login', async (req, reply) => {
    const { code } = req.body as { code?: string }
    if (!code) return fail(reply, 400, '缺少授权码')

    const db = getDb()

    try {
      const info = await exchangeCodeForToken(code)
      if (!info.open_id) return fail(reply, 400, '获取飞书用户信息失败')

      let user = db.prepare('SELECT * FROM users WHERE feishu_open_id = ?').get(info.open_id) as UserRow | undefined

      if (!user) {
        const id = uuid()
        const role = determineRole(info.open_id)
        const username = `feishu_${info.open_id.slice(0, 12)}`
        db.prepare(
          'INSERT INTO users (id, username, display_name, password_hash, role, feishu_open_id, feishu_name, feishu_avatar_url, username_changed) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 0)',
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
          username_changed: 0,
          created_at: new Date().toISOString(),
        }
      } else {
        db.prepare('UPDATE users SET display_name = ?, feishu_name = ?, feishu_avatar_url = ? WHERE id = ?').run(
          info.name, info.name, info.avatar_url || null, user.id,
        )
      }

      if (user.role === 'member') {
        notifyNewGuest(user.display_name).catch((e: unknown) => app.log.error(`通知新成员失败: ${e instanceof Error ? e.message : e}`))
      }

      const token = signToken({
        userId: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role as 'admin' | 'member' | 'guest',
        tokenVersion: user.token_version,
        avatarUrl: user.feishu_avatar_url || undefined,
        feishuName: user.feishu_name || undefined,
      })

      reply.header('Set-Cookie', `auth_token=${token}; Path=/; SameSite=Lax; Max-Age=86400`)
      return success({
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          avatarUrl: user.feishu_avatar_url || '',
          feishuName: user.feishu_name || '',
        },
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '飞书登录失败'
      return fail(reply, 500, msg)
    }
  })
}