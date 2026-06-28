// 认证路由：密码登录 + 飞书登录
import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { signToken } from '../auth/jwt.js'
import { getDb } from '../db/index.js'
import { v4 as uuid } from 'uuid'
import type { UserRow } from '../types.js'
import { getFeishuAuthUrl, getRedirectOrigin, exchangeCodeForToken } from '../services/feishu.js'
import { determineRole } from '../auth/feishu.js'
import { notifyNewGuest } from '../services/notifications.js'
import { recordAudit } from '../services/audit.js'
import { success, fail } from '../lib/response.js'
import { authMiddleware } from '../auth/middleware.js'
import { generateState } from '../lib/crypto.js'
import { generateCsrfToken } from '../lib/csrf.js'
import { config } from '../config.js'
import { loginRequestSchema, loginResponseSchema, errorResponseSchema } from '../lib/swagger.js'

/** 同时设置 auth_token + csrf_token，避免 Set-Cookie 被覆盖 */
function setLoginCookies(
  reply: { header: (name: string, value: string | string[]) => void },
  token: string,
  csrfToken: string,
) {
  const secure = config.isProduction ? '; Secure' : ''
  reply.header('Set-Cookie', [
    `auth_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`,
    `csrf_token=${csrfToken}; Path=/; SameSite=Strict; Max-Age=86400`,
  ])
}

export async function authRoutes(app: FastifyInstance) {
  // 密码登录（严格限速：1分钟最多5次）
  app.post(
    '/api/v1/auth/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        description: '用户名密码登录，返回 JWT token',
        body: loginRequestSchema,
        response: {
          200: loginResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body as { username: string; password: string }

      if (!username || !password) {
        return fail(reply, 400, '请输入用户名和密码')
      }
      const db = getDb()
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
        | UserRow
        | undefined
      if (!user) {
        recordAudit({
          userId: 'anonymous',
          username: username,
          action: 'auth.login_failed',
          targetType: 'auth',
          detail: { reason: '用户不存在', username },
        })
        return fail(reply, 401, '用户名或密码错误')
      }
      if (!user.password_hash) {
        recordAudit({
          userId: 'anonymous',
          username: username,
          action: 'auth.login_failed',
          targetType: 'auth',
          detail: { reason: '未设置密码', username },
        })
        return fail(reply, 401, '该账号未设置密码，请使用飞书登录')
      }

      const passwordMatch = bcrypt.compareSync(password, user.password_hash)
      if (!passwordMatch) {
        recordAudit({
          userId: 'anonymous',
          username: username,
          action: 'auth.login_failed',
          targetType: 'auth',
          detail: { reason: '密码错误', username },
        })
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
      // 设置 cookie，供文档站点页面导航鉴权 + CSRF 保护
      setLoginCookies(reply, token, generateCsrfToken())

      recordAudit({
        userId: user.id,
        username: user.username,
        action: 'auth.login',
        targetType: 'auth',
        detail: { method: 'password' },
      })

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
    },
  )

  // 登出：递增 token_version 使所有 JWT 失效
  app.post('/api/v1/auth/logout', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(
      req.user!.userId,
    )

    recordAudit({
      userId: req.user!.userId,
      username: req.user?.username || '',
      action: 'auth.logout',
      targetType: 'auth',
    })

    return success({ ok: true })
  })

  // 飞书登录 URL
  app.get('/api/v1/auth/feishu/login-url', async (req, reply) => {
    const state = `login:${generateState()}`
    try {
      const origin = getRedirectOrigin(req)
      const redirectUri = origin ? `${origin}/feishu-callback` : ''
      const url = getFeishuAuthUrl(state, redirectUri)
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

      let user = db.prepare('SELECT * FROM users WHERE feishu_open_id = ?').get(info.open_id) as
        | UserRow
        | undefined

      let isNewUser = false
      let wasRelinked = false

      if (!user) {
        const role = determineRole(info.open_id)
        const username = `feishu_${info.open_id.slice(0, 12)}`

        // 检查是否是之前绑定过但解绑了的用户（feishu_open_id 已清空但 username 仍为 feishu_ 前缀）
        const existing = db
          .prepare('SELECT * FROM users WHERE username = ? AND feishu_open_id IS NULL')
          .get(username) as UserRow | undefined

        if (existing) {
          wasRelinked = true
          // 重新关联飞书账号
          db.prepare(
            'UPDATE users SET feishu_open_id = ?, feishu_name = ?, feishu_avatar_url = ?, display_name = ? WHERE id = ?',
          ).run(info.open_id, info.name, info.avatar_url || null, info.name, existing.id)

          user = {
            ...existing,
            feishu_open_id: info.open_id,
            feishu_name: info.name,
            feishu_avatar_url: info.avatar_url || null,
            display_name: info.name,
          }
        } else {
          isNewUser = true
          const id = uuid()
          db.prepare(
            'INSERT INTO users (id, username, display_name, password_hash, role, feishu_open_id, feishu_name, feishu_avatar_url, username_changed) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 0)',
          ).run(id, username, info.name, role, info.open_id, info.name, info.avatar_url || null)

          // 新注册的 member 用户自动加入默认项目（只读）
          if (role === 'member') {
            db.prepare(
              'INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
            ).run('default', id, 'viewer')
          }

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
        }
      } else {
        db.prepare(
          'UPDATE users SET display_name = ?, feishu_name = ?, feishu_avatar_url = ? WHERE id = ?',
        ).run(info.name, info.name, info.avatar_url || null, user.id)
      }

      if (user.role === 'member') {
        notifyNewGuest(user.display_name).catch((e: unknown) =>
          app.log.error(`通知新成员失败: ${e instanceof Error ? e.message : e}`),
        )
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

      setLoginCookies(reply, token, generateCsrfToken())

      recordAudit({
        userId: user.id,
        username: user.username,
        action: 'auth.feishu_login',
        targetType: 'auth',
        detail: { isNewUser, relinked: wasRelinked, openId: info.open_id },
      })

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
