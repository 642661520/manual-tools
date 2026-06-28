/** 全文搜索 API */
import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/middleware.js'
import { isProjectMember } from '../auth/membership.js'
import { searchDocs, rebuildProjectIndex } from '../services/search.js'
import { recordAudit } from '../services/audit.js'
import { success, fail } from '../lib/response.js'
import { requireRole } from '../auth/middleware.js'

export async function searchRoutes(app: FastifyInstance) {
  app.get('/api/v1/search', { preHandler: authMiddleware }, async (req, reply) => {
    const { q, projectId, limit } = req.query as { q?: string; projectId?: string; limit?: string }
    if (!q?.trim()) return success({ results: [], total: 0 })
    if (!projectId) return fail(reply, 400, '缺少 projectId 参数')

    // 仅项目成员可搜索
    if (!isProjectMember(req.user!.userId, req.user!.role, projectId)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    try {
      const results = searchDocs(q, projectId, limit ? parseInt(limit) : 100)
      return success({ results, total: results.length })
    } catch (e: unknown) {
      return fail(reply, 500, e instanceof Error ? e.message : '搜索失败')
    }
  })

  // 重建项目索引（admin only）
  app.post(
    '/api/v1/search/rebuild',
    { preHandler: [authMiddleware, requireRole('admin')] },
    async (req, reply) => {
      const { projectId } = req.body as { projectId?: string }
      if (!projectId) return fail(reply, 400, '缺少 projectId')
      try {
        rebuildProjectIndex(projectId)

        recordAudit({
          userId: req.user!.userId,
          username: req.user?.username || '',
          action: 'search.rebuild_index',
          targetType: 'project',
          targetId: projectId,
        })

        return success({ ok: true })
      } catch (e: unknown) {
        return fail(reply, 500, e instanceof Error ? e.message : '重建失败')
      }
    },
  )
}
