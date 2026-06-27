/** 版本对比 API — 两个发布版本的 Markdown 逐行 diff */
import { FastifyInstance } from 'fastify'
import { diffLines, Change } from 'diff'
import { authMiddleware } from '../auth/middleware.js'
import { isProjectMember } from '../auth/membership.js'
import { getDb } from '../db/index.js'
import { success, fail } from '../lib/response.js'

export interface DiffResult {
  v1: { major: number; minor: number; title: string }
  v2: { major: number; minor: number; title: string }
  lines: { type: 'added' | 'removed' | 'unchanged'; text: string }[]
  stats: { added: number; removed: number; unchanged: number }
}

export async function diffRoutes(app: FastifyInstance) {
  app.get('/api/v1/catalogs/:id/diff', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { v1, v2 } = req.query as { v1?: string; v2?: string }
    if (!v1 || !v2) return fail(reply, 400, '请选择两个版本进行对比 (v1=old&v2=new)')

    const db = getDb()
    const catalog = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(id) as
      | { project_id: string }
      | undefined
    if (!catalog) return fail(reply, 404, 'Catalog not found')
    if (!isProjectMember(req.user!.userId, req.user!.role, catalog.project_id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    const v1Row = db
      .prepare('SELECT * FROM catalog_versions WHERE catalog_id = ? AND id = ?')
      .get(id, v1) as
      | { version_major: number; version_minor: number; title: string; markdown: string }
      | undefined
    const v2Row = db
      .prepare('SELECT * FROM catalog_versions WHERE catalog_id = ? AND id = ?')
      .get(id, v2) as
      | { version_major: number; version_minor: number; title: string; markdown: string }
      | undefined
    if (!v1Row || !v2Row) return fail(reply, 404, '版本不存在')

    const changes: Change[] = diffLines(v1Row.markdown, v2Row.markdown)
    const lines: DiffResult['lines'] = []
    let added = 0,
      removed = 0,
      unchanged = 0

    for (const c of changes) {
      for (const line of c.value.split('\n')) {
        if (!line && c.added === undefined && c.removed === undefined) continue
        if (c.added) {
          lines.push({ type: 'added', text: line })
          added++
        } else if (c.removed) {
          lines.push({ type: 'removed', text: line })
          removed++
        } else {
          lines.push({ type: 'unchanged', text: line })
          unchanged++
        }
      }
    }

    return success({
      v1: { major: v1Row.version_major, minor: v1Row.version_minor, title: v1Row.title },
      v2: { major: v2Row.version_major, minor: v2Row.version_minor, title: v2Row.title },
      lines,
      stats: { added, removed, unchanged },
    })
  })
}
