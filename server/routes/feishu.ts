// 飞书账号绑定路由
import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/middleware.js'
import { getDb } from '../db/index.js'
import { getFeishuAuthUrl, exchangeCodeForToken } from '../services/feishu.js'

export async function feishuRoutes(app: FastifyInstance) {
  // 生成绑定 OAuth URL
  app.get('/api/auth/feishu/bind-url', { preHandler: authMiddleware }, async (req) => {
    const userId = req.user!.userId
    const random = Math.random().toString(36).slice(2, 8)
    const state = `${userId}:${random}`
    const url = getFeishuAuthUrl(state)
    return { url }
  })

  // 完成飞书绑定
  app.put('/api/auth/me/feishu-binding', { preHandler: authMiddleware }, async (req, reply) => {
    const { code } = req.body as { code?: string }
    if (!code) return reply.status(400).send({ error: '缺少授权码' })

    const db = getDb()
    const userId = req.user!.userId

    try {
      const info = await exchangeCodeForToken(code)
      if (!info.open_id) return reply.status(400).send({ error: '获取飞书用户信息失败' })

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

  // 查询绑定状态
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

  // 解除绑定
  app.delete('/api/auth/me/feishu-binding', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    db.prepare('UPDATE users SET feishu_open_id = NULL, feishu_name = NULL, feishu_avatar_url = NULL WHERE id = ?').run(req.user!.userId)
    return { ok: true }
  })
}
