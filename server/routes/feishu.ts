// 飞书账号绑定路由
import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/middleware.js'
import { getDb } from '../db/index.js'
import { getFeishuAuthUrl, exchangeCodeForToken } from '../services/feishu.js'
import { generateState } from '../lib/crypto.js'
import { success, ok, fail } from '../lib/response.js'

export async function feishuRoutes(app: FastifyInstance) {
  // 生成绑定 OAuth URL
  app.get('/api/v1/auth/feishu/bind-url', { preHandler: authMiddleware }, async (req) => {
    const userId = req.user!.userId
    const state = `${userId}:${generateState()}`
    const url = getFeishuAuthUrl(state)
    return success({ url })
  })

  // 完成飞书绑定
  app.put('/api/v1/auth/me/feishu-binding', { preHandler: authMiddleware }, async (req, reply) => {
    const { code } = req.body as { code?: string }
    if (!code) return fail(reply, 400, '缺少授权码')

    const db = getDb()
    const userId = req.user!.userId

    try {
      const info = await exchangeCodeForToken(code)
      if (!info.open_id) return fail(reply, 400, '获取飞书用户信息失败')

      const existing = db
        .prepare('SELECT id FROM users WHERE feishu_open_id = ? AND id != ?')
        .get(info.open_id, userId) as { id: string } | undefined

      if (existing) {
        return fail(reply, 409, '该飞书账号已被其他用户绑定')
      }

      db.prepare(
        'UPDATE users SET display_name = ?, feishu_open_id = ?, feishu_name = ?, feishu_avatar_url = ? WHERE id = ?',
      ).run(info.name, info.open_id, info.name, info.avatar_url || null, userId)

      return success({
        openId: info.open_id,
        name: info.name,
        avatarUrl: info.avatar_url || '',
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '飞书授权失败'
      return fail(reply, 500, msg)
    }
  })

  // 查询绑定状态
  app.get('/api/v1/auth/me/feishu-binding', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    const user = db
      .prepare('SELECT feishu_open_id, feishu_name, feishu_avatar_url FROM users WHERE id = ?')
      .get(req.user!.userId) as
      | {
          feishu_open_id: string | null
          feishu_name: string | null
          feishu_avatar_url: string | null
        }
      | undefined

    if (!user?.feishu_open_id) {
      return success({ bound: false })
    }

    return success({
      bound: true,
      openId: user.feishu_open_id,
      name: user.feishu_name || '',
      avatarUrl: user.feishu_avatar_url || '',
    })
  })

  // 解除绑定
  app.delete('/api/v1/auth/me/feishu-binding', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    db.prepare(
      'UPDATE users SET feishu_open_id = NULL, feishu_name = NULL, feishu_avatar_url = NULL WHERE id = ?',
    ).run(req.user!.userId)
    return ok()
  })
}
