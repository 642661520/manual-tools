import { FastifyInstance } from 'fastify'
import { rm } from 'fs/promises'
import { join } from 'path'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { success, ok, fail } from '../lib/response.js'
import { isProjectMember, hasProjectRole } from '../auth/membership.js'
import {
  notifyJoinProject,
  notifyLeaveProject,
  notifyProjectRoleChange,
} from '../services/notifications.js'
import { v4 as uuid } from 'uuid'
import type { ProjectRow, CreateProjectBody, UpdateProjectBody, UserRow } from '../types.js'
import { projectSchema, errorResponseSchema, okResponseSchema } from '../lib/swagger.js'

export async function projectRoutes(app: FastifyInstance) {
  // 获取项目列表（admin/guest 看全部，member 只看自己加入的）
  app.get(
    '/api/v1/projects',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['projects'],
        description: '获取项目列表。admin/guest 看全部，member 只看自己加入的项目',
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean', const: true },
              data: { type: 'array', items: projectSchema },
            },
          },
        },
      },
    },
    async (req) => {
      const db = getDb()
      const userId = req.user!.userId
      const role = req.user!.role

      if (role === 'admin' || role === 'guest') {
        const rows = db.prepare('SELECT * FROM projects ORDER BY created_at').all()
        return success(rows)
      }
      const rows = db
        .prepare(`
      SELECT p.* FROM projects p
      JOIN project_members pm ON p.id = pm.project_id
      WHERE pm.user_id = ?
      ORDER BY p.created_at
    `)
        .all(userId)
      return success(rows)
    },
  )

  // 获取单个项目
  app.get('/api/v1/projects/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined
    if (!project) return fail(reply, 404, '项目不存在')
    if (!isProjectMember(req.user!.userId, req.user!.role, id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }
    return success(project)
  })

  // 创建项目（admin only，自动加入成员）
  app.post(
    '/api/v1/projects',
    {
      preHandler: [authMiddleware, requireRole('admin')],
      schema: {
        tags: ['projects'],
        description: '创建新项目（仅 admin），创建者自动成为项目 PM',
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: '项目名称' },
            description: { type: 'string', description: '项目描述' },
          },
        },
        response: {
          200: { type: 'object', properties: { ok: { type: 'boolean' }, data: projectSchema } },
          400: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const body = req.body as CreateProjectBody
      if (!body.name?.trim()) return fail(reply, 400, '项目名称不能为空')

      const id = uuid().slice(0, 8)
      const db = getDb()
      db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)').run(
        id,
        body.name.trim(),
        body.description || '',
      )
      // 创建者自动加入项目成员为 pm
      db.prepare(
        'INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
      ).run(id, req.user!.userId, 'pm')
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow
      return success(row)
    },
  )

  // 更新项目（admin only）
  app.put(
    '/api/v1/projects/:id',
    { preHandler: [authMiddleware, requireRole('admin')] },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const body = req.body as UpdateProjectBody
      if (!body.name?.trim()) return fail(reply, 400, '项目名称不能为空')

      const db = getDb()
      const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
      if (!existing) return fail(reply, 404, '项目不存在')

      db.prepare(
        "UPDATE projects SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(body.name.trim(), body.description || '', id)

      // 审核链更新（如果传入）
      if (body.reviewChain !== undefined) {
        db.prepare(
          "UPDATE projects SET review_chain = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(JSON.stringify(body.reviewChain), id)
      }

      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow
      return success(row)
    },
  )

  // 删除项目（admin only，不允许删除 default）
  app.delete(
    '/api/v1/projects/:id',
    {
      preHandler: [authMiddleware, requireRole('admin')],
      schema: {
        tags: ['projects'],
        description:
          '删除项目（不允许删除 default 项目），级联清理 features、catalogs、文档站点文件',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        response: {
          200: okResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      if (id === 'default') return fail(reply, 403, '不能删除默认项目')

      const db = getDb()
      const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
      if (!existing) return fail(reply, 404, '项目不存在')

      // FK ON DELETE CASCADE 自动清理 features、catalogs、project_members
      // 先查询所有 catalog ID，用于后续清理文档站点文件
      const catalogIds = (
        db.prepare('SELECT id FROM catalogs WHERE project_id = ?').all(id) as Array<{ id: string }>
      ).map((r) => r.id)

      db.prepare('DELETE FROM catalogs WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM features WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)

      // 清理所有 catalog 的文档站点文件
      for (const cid of catalogIds) {
        const docsDir = join(process.cwd(), 'data/docs', cid)
        rm(docsDir, { recursive: true, force: true }).catch((err) => {
          app.log.error(
            `清理文档站点失败 (catalog ${cid}): ${err instanceof Error ? err.message : err}`,
          )
        })
      }

      return ok()
    },
  )

  // ===== 成员管理 =====

  // 获取项目成员列表
  app.get('/api/v1/projects/:id/members', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.userId
    const role = req.user!.role

    if (!isProjectMember(userId, role, id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    const db = getDb()
    const members = db
      .prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.feishu_open_id, u.feishu_name, u.feishu_avatar_url, pm.role as project_role
      FROM users u
      JOIN project_members pm ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY pm.role, u.display_name
    `)
      .all(id) as (UserRow & { project_role: string })[]
    return success(members)
  })

  // 添加项目成员（admin 或项目 pm 可操作）
  app.post(
    '/api/v1/projects/:id/members',
    { preHandler: [authMiddleware, requireRole('admin', 'member')] },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const userId = req.user!.userId
      const role = req.user!.role

      if (!hasProjectRole(userId, role, id, 'pm')) {
        return fail(reply, 403, '项目内权限不足')
      }

      const { userId: targetUserId, projectRole } = req.body as {
        userId: string
        projectRole?: string
      }
      if (!targetUserId) {
        return fail(reply, 400, '请指定用户')
      }

      const db = getDb()
      // 验证目标用户存在
      const targetUser = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetUserId) as
        | { id: string; role: string }
        | undefined
      if (!targetUser) {
        return fail(reply, 404, '用户不存在')
      }
      if (targetUser.role === 'guest') {
        return fail(reply, 400, '游客不能被加入项目，请先修改系统角色为成员')
      }

      const memberRole = projectRole || 'writer'
      if (!['pm', 'writer', 'viewer'].includes(memberRole)) {
        return fail(reply, 400, '无效的项目角色')
      }

      // 检查是否已是项目成员
      const existingMember = db
        .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(id, targetUserId) as { role: string } | undefined
      const isExistingMember = !!existingMember

      db.prepare(
        'INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
      ).run(id, targetUserId, memberRole)
      // 如果已存在，更新角色
      db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').run(
        memberRole,
        id,
        targetUserId,
      )

      const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(id) as
        | { name: string }
        | undefined
      const operator = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as
        | { display_name: string }
        | undefined
      const operatorName = operator?.display_name || '系统管理员'
      const projectName = project?.name || id

      if (isExistingMember) {
        // 角色变更通知
        if (existingMember.role !== memberRole) {
          notifyProjectRoleChange(
            projectName,
            targetUserId,
            existingMember.role,
            memberRole,
            operatorName,
          ).catch((e) =>
            app.log.error(`飞书通知失败(项目角色变更) ${e instanceof Error ? e.message : e}`),
          )
        }
      } else {
        // 新加入通知
        notifyJoinProject(projectName, targetUserId, operatorName, memberRole).catch((e) =>
          app.log.error(`飞书通知失败(加入项目) ${e instanceof Error ? e.message : e}`),
        )
      }

      return ok()
    },
  )

  // 移除项目成员（admin 或项目 pm 可操作，不能移除自己）
  app.delete(
    '/api/v1/projects/:id/members/:userId',
    { preHandler: [authMiddleware, requireRole('admin', 'member')] },
    async (req, reply) => {
      const { id, userId: targetUserId } = req.params as { id: string; userId: string }
      const operatorId = req.user!.userId
      const operatorRole = req.user!.role

      if (!hasProjectRole(operatorId, operatorRole, id, 'pm')) {
        return fail(reply, 403, '项目内权限不足')
      }

      if (targetUserId === operatorId) {
        return fail(reply, 400, '不能移除自己')
      }

      const db = getDb()

      // 获取项目名和操作人名（在删除前查询）
      const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(id) as
        | { name: string }
        | undefined
      const operator = db.prepare('SELECT display_name FROM users WHERE id = ?').get(operatorId) as
        | { display_name: string }
        | undefined

      db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(
        id,
        targetUserId,
      )

      // 清理该项目下所有该用户的编写指派
      const docs = db
        .prepare(`
      SELECT d.id, d.assignees FROM documents d
      JOIN features f ON f.id = d.feature_id
      WHERE f.project_id = ?
    `)
        .all(id) as { id: string; assignees: string }[]
      for (const doc of docs) {
        try {
          const assignees: string[] = JSON.parse(doc.assignees || '[]')
          const updated = assignees.filter((a) => a !== targetUserId)
          if (updated.length !== assignees.length) {
            db.prepare('UPDATE documents SET assignees = ? WHERE id = ?').run(
              JSON.stringify(updated),
              doc.id,
            )
          }
        } catch {
          /* ignore */
        }
      }

      // 通知被移出的用户
      notifyLeaveProject(
        project?.name || id,
        targetUserId,
        operator?.display_name || '系统管理员',
      ).catch((e) => app.log.error(`飞书通知失败(移出项目) ${e instanceof Error ? e.message : e}`))

      return ok()
    },
  )

  // ===== 审核链管理 =====

  // 获取项目审核链（含可用 PM 列表供选择）
  app.get(
    '/api/v1/projects/:id/review-chain',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const userId = req.user!.userId
      const role = req.user!.role

      if (!isProjectMember(userId, role, id)) {
        return fail(reply, 403, '你不是该项目的成员')
      }

      const db = getDb()
      const project = db.prepare('SELECT review_chain FROM projects WHERE id = ?').get(id) as
        | { review_chain: string }
        | undefined
      if (!project) return fail(reply, 404, '项目不存在')

      const chain = JSON.parse(project.review_chain || '[]') as string[]

      // 获取该项目的所有 PM 成员（查 project_members.role = 'pm'）
      const availablePMs = db
        .prepare(`
      SELECT u.id, u.username, u.display_name, u.role
      FROM users u
      JOIN project_members pm ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.role = 'pm'
      ORDER BY u.display_name
    `)
        .all(id) as { id: string; username: string; display_name: string; role: string }[]

      // 审核链中已有的用户详情
      const chainUsers = chain.map((cid) => {
        const u = availablePMs.find((p) => p.id === cid)
        return u || { id: cid, username: '', display_name: cid, role: 'pm' }
      })

      return success({ chain: chainUsers, availablePMs })
    },
  )

  // 更新项目审核链（admin 或项目 pm 可操作）
  app.put(
    '/api/v1/projects/:id/review-chain',
    { preHandler: [authMiddleware, requireRole('admin', 'member')] },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const userId = req.user!.userId
      const role = req.user!.role

      if (!hasProjectRole(userId, role, id, 'pm')) {
        return fail(reply, 403, '项目内权限不足')
      }

      const { reviewChain } = req.body as { reviewChain: string[] }
      if (!Array.isArray(reviewChain)) {
        return fail(reply, 400, '审核链格式错误')
      }

      const db = getDb()
      // 验证所有 ID 都是该项目的 PM 成员
      const pmMembers = db
        .prepare(`
      SELECT u.id FROM users u
      JOIN project_members pm ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.role = 'pm'
    `)
        .all(id) as { id: string }[]
      const pmIds = new Set(pmMembers.map((p) => p.id))

      for (const cid of reviewChain) {
        if (!pmIds.has(cid)) {
          return fail(reply, 400, `用户 ${cid} 不是该项目的 PM 成员`)
        }
      }

      db.prepare(
        "UPDATE projects SET review_chain = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(JSON.stringify(reviewChain), id)

      return ok()
    },
  )
}
