import { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { hasProjectRole } from '../auth/membership.js'
import { success, ok, fail } from '../lib/response.js'
import { v4 as uuid } from 'uuid'
import type { CategoryRow, CreateCategoryBody, UpdateCategoryBody } from '../types.js'

export async function categoryRoutes(app: FastifyInstance) {
  // 获取分类列表
  app.get('/api/v1/categories', { preHandler: authMiddleware }, async (req) => {
    const { projectId } = req.query as { projectId?: string }
    const db = getDb()

    if (projectId) {
      const rows = db
        .prepare('SELECT * FROM categories WHERE project_id = ? ORDER BY sort_order ASC, name ASC')
        .all(projectId) as CategoryRow[]
      return success(rows)
    }
    const rows = db
      .prepare('SELECT * FROM categories ORDER BY sort_order ASC, name ASC')
      .all() as CategoryRow[]
    return success(rows)
  })

  // 创建分类（项目 pm+ 可操作）
  app.post(
    '/api/v1/categories',
    { preHandler: [authMiddleware, requireRole('admin', 'member')] },
    async (req, reply) => {
      const body = req.body as CreateCategoryBody
      if (!body.name?.trim()) return fail(reply, 400, '分类名称不能为空')

      const projectId = body.projectId || 'default'
      if (!hasProjectRole(req.user!.userId, req.user!.role, projectId, 'pm')) {
        return fail(reply, 403, '项目内权限不足')
      }

      const db = getDb()
      const id = uuid().slice(0, 8)

      // 自动计算排序号
      const maxSort = db
        .prepare(
          'SELECT COALESCE(MAX(sort_order), 0) as max_sort FROM categories WHERE project_id = ?',
        )
        .get(projectId) as { max_sort: number }
      const sortOrder = body.sort_order ?? maxSort.max_sort + 1

      db.prepare(`
      INSERT INTO categories (id, name, color, sort_order, project_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, body.name.trim(), body.color || '#6366f1', sortOrder, projectId)

      const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow
      return success(created)
    },
  )

  // 更新分类（项目 pm+ 可操作）
  app.put(
    '/api/v1/categories/:id',
    { preHandler: [authMiddleware, requireRole('admin', 'member')] },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const body = req.body as UpdateCategoryBody
      if (!body.name?.trim()) return fail(reply, 400, '分类名称不能为空')

      const db = getDb()
      const existing = db.prepare('SELECT id, project_id FROM categories WHERE id = ?').get(id) as
        | Pick<CategoryRow, 'id' | 'project_id'>
        | undefined
      if (!existing) return fail(reply, 404, '分类不存在')

      if (!hasProjectRole(req.user!.userId, req.user!.role, existing.project_id, 'pm')) {
        return fail(reply, 403, '项目内权限不足')
      }

      db.prepare(`
      UPDATE categories SET name = ?, color = ?, sort_order = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(body.name.trim(), body.color || '#6366f1', body.sort_order ?? 0, id)

      const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow
      return success(updated)
    },
  )

  // 删除分类（项目 pm+ 可操作）
  app.delete(
    '/api/v1/categories/:id',
    { preHandler: [authMiddleware, requireRole('admin', 'member')] },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const db = getDb()

      const existing = db.prepare('SELECT id, project_id FROM categories WHERE id = ?').get(id) as
        | Pick<CategoryRow, 'id' | 'project_id'>
        | undefined
      if (!existing) return fail(reply, 404, '分类不存在')

      if (!hasProjectRole(req.user!.userId, req.user!.role, existing.project_id, 'pm')) {
        return fail(reply, 403, '项目内权限不足')
      }

      // ON DELETE SET NULL 自动将关联章节的 category_id 置空
      db.prepare('DELETE FROM categories WHERE id = ?').run(id)
      return ok()
    },
  )
}
