// 认证路由：密码登录 + 飞书登录
import { FastifyInstance } from 'fastify'
import { signToken } from '../auth/jwt.js'
import { getDb } from '../db/index.js'
import { v4 as uuid } from 'uuid'
import type { UserRow } from '../types.js'
import { getFeishuAuthUrl, exchangeCodeForToken } from '../services/feishu.js'
import { determineRole } from '../auth/feishu.js'
import { notifyNewGuest } from '../services/notifications.js'

export async function authRoutes(app: FastifyInstance) {
  // 密码登录
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string }

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

  // 飞书登录 URL
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

  // 飞书登录回调
  app.post('/api/auth/feishu/login', async (req, reply) => {
    const { code } = req.body as { code?: string }
    if (!code) return reply.status(400).send({ error: '缺少授权码' })

    const db = getDb()

    try {
      const info = await exchangeCodeForToken(code)
      if (!info.open_id) return reply.status(400).send({ error: '获取飞书用户信息失败' })

      let user = db.prepare('SELECT * FROM users WHERE feishu_open_id = ?').get(info.open_id) as UserRow | undefined

      if (!user) {
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
        db.prepare('UPDATE users SET display_name = ?, feishu_name = ?, feishu_avatar_url = ? WHERE id = ?').run(
          info.name, info.name, info.avatar_url || null, user.id,
        )
      }

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
}
