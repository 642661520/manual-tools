import { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { success, ok, fail } from '../lib/response.js'
import { isProjectMember, isExplicitMember } from '../auth/membership.js'
import { notifyJoinProject, notifyLeaveProject } from '../services/notifications.js'
import { v4 as uuid } from 'uuid'
import type { ProjectRow, CreateProjectBody, UpdateProjectBody, UserRow } from '../types.js'

export async function projectRoutes(app: FastifyInstance) {
  // 获取项目列表（pm 看全部，ops/guest 只看自己加入的）
  app.get('/api/v1/projects', { preHandler: authMiddleware }, async (req) => {
    const db = getDb()
    const userId = req.user!.userId
    const role = req.user!.role

    if (role === 'pm') {
      const rows = db.prepare('SELECT * FROM projects ORDER BY created_at').all()
      return success(rows)
    }
    const rows = db.prepare(`
      SELECT p.* FROM projects p
      JOIN project_members pm ON p.id = pm.project_id
      WHERE pm.user_id = ?
      ORDER BY p.created_at
    `).all(userId)
    return success(rows)
  })

  // 获取单个项目
  app.get('/api/v1/projects/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
    if (!project) return fail(reply, 404, '项目不存在')
    return success(project)
  })

  // 创建项目（PM only，自动加入成员）
  app.post('/api/v1/projects', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const body = req.body as CreateProjectBody
    if (!body.name?.trim()) return fail(reply, 400, '项目名称不能为空')

    const id = uuid().slice(0, 8)
    const db = getDb()
    db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)').run(
      id,
      body.name.trim(),
      body.description || '',
    )
    // 创建者自动加入项目成员
    db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(
      id, req.user!.userId,
    )
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow
    return success(row)
  })

  // 更新项目（PM only）
  app.put('/api/v1/projects/:id', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as UpdateProjectBody
    if (!body.name?.trim()) return fail(reply, 400, '项目名称不能为空')

    const db = getDb()
    const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
    if (!existing) return fail(reply, 404, '项目不存在')

    db.prepare("UPDATE projects SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?")
      .run(body.name.trim(), body.description || '', id)

    // 审核链更新（如果传入）
    if (body.reviewChain !== undefined) {
      db.prepare('UPDATE projects SET review_chain = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(JSON.stringify(body.reviewChain), id)
    }

    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow
    return success(row)
  })

  // 删除项目（PM only，不允许删除 default）
  app.delete('/api/v1/projects/:id', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (id === 'default') return fail(reply, 403, '不能删除默认项目')

    const db = getDb()
    const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
    if (!existing) return fail(reply, 404, '项目不存在')

    // FK ON DELETE CASCADE 自动清理 features、catalogs、project_members
    db.prepare('DELETE FROM catalogs WHERE project_id = ?').run(id)
    db.prepare('DELETE FROM features WHERE project_id = ?').run(id)
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)

    return ok()
  })

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
    const members = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.feishu_open_id, u.feishu_name, u.feishu_avatar_url
      FROM users u
      JOIN project_members pm ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY u.role, u.display_name
    `).all(id) as UserRow[]
    return success(members)
  })

  // 添加项目成员（仅 PM + 项目成员可操作）
  app.post('/api/v1/projects/:id/members', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.userId

    if (!isExplicitMember(userId, id)) {
      return fail(reply, 403, '你不是该项目的成员，无法管理成员')
    }

    const { userId: targetUserId } = req.body as { userId: string }
    if (!targetUserId) {
      return fail(reply, 400, '请指定用户')
    }

    const db = getDb()
    // 验证目标用户存在
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId)
    if (!targetUser) {
      return fail(reply, 404, '用户不存在')
    }

    db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(id, targetUserId)

    // 通知被加入的用户
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(id) as { name: string } | undefined
    const operator = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as { display_name: string } | undefined
    notifyJoinProject(project?.name || id, targetUserId, operator?.display_name || '管理员')
      .catch(e => console.error('飞书通知失败(加入项目):', e))

    return ok()
  })

  // 移除项目成员（仅 PM + 项目成员可操作，不能移除自己）
  app.delete('/api/v1/projects/:id/members/:userId', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id, userId: targetUserId } = req.params as { id: string; userId: string }
    const operatorId = req.user!.userId

    if (!isExplicitMember(operatorId, id)) {
      return fail(reply, 403, '你不是该项目的成员，无法管理成员')
    }

    if (targetUserId === operatorId) {
      return fail(reply, 400, '不能移除自己')
    }

    const db = getDb()

    // 获取项目名和操作人名（在删除前查询）
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(id) as { name: string } | undefined
    const operator = db.prepare('SELECT display_name FROM users WHERE id = ?').get(operatorId) as { display_name: string } | undefined

    db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(id, targetUserId)

    // 清理该项目下所有该用户的编写指派
    const docs = db.prepare(`
      SELECT d.id, d.assignees FROM documents d
      JOIN features f ON f.id = d.feature_id
      WHERE f.project_id = ?
    `).all(id) as { id: string; assignees: string }[]
    for (const doc of docs) {
      try {
        const assignees: string[] = JSON.parse(doc.assignees || '[]')
        const updated = assignees.filter(a => a !== targetUserId)
        if (updated.length !== assignees.length) {
          db.prepare('UPDATE documents SET assignees = ? WHERE id = ?').run(JSON.stringify(updated), doc.id)
        }
      } catch { /* ignore */ }
    }

    // 通知被移出的用户
    notifyLeaveProject(project?.name || id, targetUserId, operator?.display_name || '管理员')
      .catch(e => console.error('飞书通知失败(移出项目):', e))

    return ok()
  })

  // ===== 审核链管理 =====

  // 获取项目审核链（含可用 PM 列表供选择）
  app.get('/api/v1/projects/:id/review-chain', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.userId
    const role = req.user!.role

    if (!isProjectMember(userId, role, id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    const db = getDb()
    const project = db.prepare('SELECT review_chain FROM projects WHERE id = ?').get(id) as { review_chain: string } | undefined
    if (!project) return fail(reply, 404, '项目不存在')

    const chain = JSON.parse(project.review_chain || '[]') as string[]

    // 获取该项目的所有 PM 成员（供选择）
    const availablePMs = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role
      FROM users u
      JOIN project_members pm ON u.id = pm.user_id
      WHERE pm.project_id = ? AND u.role = 'pm'
      ORDER BY u.display_name
    `).all(id) as { id: string; username: string; display_name: string; role: string }[]

    // 审核链中已有的用户详情
    const chainUsers = chain.map(cid => {
      const u = availablePMs.find(p => p.id === cid)
      return u || { id: cid, username: '', display_name: cid, role: 'pm' }
    })

    return success({ chain: chainUsers, availablePMs })
  })

  // 更新项目审核链
  app.put('/api/v1/projects/:id/review-chain', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.userId

    if (!isExplicitMember(userId, id)) {
      return fail(reply, 403, '你不是该项目的成员，无法管理审核链')
    }

    const { reviewChain } = req.body as { reviewChain: string[] }
    if (!Array.isArray(reviewChain)) {
      return fail(reply, 400, '审核链格式错误')
    }

    const db = getDb()
    // 验证所有 ID 都是该项目的 PM 成员
    const pmMembers = db.prepare(`
      SELECT u.id FROM users u
      JOIN project_members pm ON u.id = pm.user_id
      WHERE pm.project_id = ? AND u.role = 'pm'
    `).all(id) as { id: string }[]
    const pmIds = new Set(pmMembers.map(p => p.id))

    for (const cid of reviewChain) {
      if (!pmIds.has(cid)) {
        return fail(reply, 400, `用户 ${cid} 不是该项目的 PM 成员`)
      }
    }

    db.prepare("UPDATE projects SET review_chain = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(reviewChain), id)

    return ok()
  })
}
