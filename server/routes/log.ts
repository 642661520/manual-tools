/** 前端错误上报路由 */
import type { FastifyInstance } from 'fastify'
import { getLogger } from '../lib/logger.js'

const log = getLogger()

export async function logRoutes(app: FastifyInstance) {
  app.post('/api/v1/log/frontend', async (req, reply) => {
    const body = req.body as {
      message: string
      stack?: string
      url?: string
      userAgent?: string
    } | null

    if (!body || !body.message) {
      return reply.status(400).send({ ok: false, error: 'message is required' })
    }

    const userId = (req as unknown as Record<string, unknown>)._userId || 'anonymous'

    log.warn(
      {
        type: 'frontend-error',
        message: body.message,
        stack: body.stack,
        url: body.url,
        userAgent: body.userAgent,
        userId,
      },
      '前端错误上报',
    )

    return reply.send({ ok: true })
  })
}
