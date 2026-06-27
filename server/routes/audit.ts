/** 审计日志查询 API */
import { FastifyInstance } from 'fastify'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { queryAuditLogs } from '../services/audit.js'
import { success, fail } from '../lib/response.js'

export async function auditRoutes(app: FastifyInstance) {
  app.get(
    '/api/v1/audit-logs',
    {
      preHandler: [authMiddleware, requireRole('admin')],
    },
    async (req, reply) => {
      const { userId, action, targetType, limit, offset } = req.query as {
        userId?: string
        action?: string
        targetType?: string
        limit?: string
        offset?: string
      }
      try {
        const result = queryAuditLogs({
          userId,
          action,
          targetType,
          limit: limit ? parseInt(limit) : 50,
          offset: offset ? parseInt(offset) : 0,
        })
        return success({ rows: result.rows, total: result.total })
      } catch (e: unknown) {
        return fail(reply, 500, e instanceof Error ? e.message : '查询失败')
      }
    },
  )
}
