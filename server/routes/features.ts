import { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { isProjectMember, hasProjectRole } from '../auth/membership.js'
import { success, created, ok, fail } from '../lib/response.js'
import { v4 as uuid } from 'uuid'
import { notifyAssignees, notifyNextReviewer, notifyWriterReviewResult, notifyDirectApprove, notifyStatusReset, notifyRemoveAssignee } from '../services/notifications.js'
import type {
  FeatureRow,
  FeatureWithStats,
  DocumentRow,
  HasContentRow,
  CreateFeatureBody,
  UpdateFeatureBody,
  UpdateSectionStatusBody,
  UpdateSectionsBody,
} from '../types.js'

type Section = { key: string; title: string; description?: string }

/** 辅助：从 feature 记录获取 project_id */
function getFeatureProjectId(featureId: string): string | null {
  const db = getDb()
  const feature = db.prepare('SELECT project_id FROM features WHERE id = ?').get(featureId) as { project_id: string } | undefined
  return feature?.project_id || null
}

/** 获取项目的有效审核链（查 project_members.role = 'pm'） */
function getEffectiveReviewChain(projectId: string): string[] {
  const db = getDb()
  const project = db.prepare('SELECT review_chain FROM projects WHERE id = ?').get(projectId) as { review_chain: string } | undefined
  if (!project) return []

  const chain = JSON.parse(project.review_chain || '[]') as string[]
  if (chain.length > 0) return chain

  // 默认：该项目所有 PM 按 display_name 排序
  const pms = db.prepare(`
    SELECT u.id FROM users u
    JOIN project_members pm ON u.id = pm.user_id
    WHERE pm.project_id = ? AND pm.role = 'pm'
    ORDER BY u.display_name
  `).all(projectId) as { id: string }[]
  return pms.map(p => p.id)
}

export async function featureRoutes(app: FastifyInstance) {
  // 获取所有主题（含状态摘要），支持按项目过滤
  app.get('/api/v1/features', { preHandler: authMiddleware }, async (req) => {
    const { projectId } = req.query as { projectId?: string }
    const db = getDb()

    let sql = `
      SELECT f.*,
        COALESCE(
          (SELECT COUNT(*) FROM documents d WHERE d.feature_id = f.id),
          0
        ) as total_sections,
        COALESCE(
          (SELECT COUNT(*) FROM documents d WHERE d.feature_id = f.id AND d.status = 'approved'),
          0
        ) as approved_sections,
        COALESCE(
          (SELECT COUNT(*) FROM documents d WHERE d.feature_id = f.id AND d.status = 'pending_review'),
          0
        ) as completed_sections,
        COALESCE(
          (SELECT COUNT(*) FROM documents d WHERE d.feature_id = f.id AND d.status IN ('in_progress','pending_review','rejected','approved')),
          0
        ) as edited_sections,
        COALESCE(
          (SELECT COUNT(*) FROM documents d WHERE d.feature_id = f.id
           AND d.section_key NOT IN (SELECT json_extract(value, '$.key') FROM json_each(f.sections))
           AND d.section_key != '_default'),
          0
        ) as orphaned_count
      FROM features f
    `
    const params: string[] = []

    if (projectId) {
      sql += ' WHERE f.project_id = ?'
      params.push(projectId)
    }

    sql += ' ORDER BY f.title'

    const features = db.prepare(sql).all(...params) as FeatureWithStats[]
    return success(features)
  })

  // 获取单个主题
  app.get('/api/v1/features/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const feature = db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
    if (!feature) return fail(reply, 404, 'Not found')

    // 检查项目成员身份
    if (!isProjectMember(req.user!.userId, req.user!.role, feature.project_id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    let sections = JSON.parse(feature.sections || '[]') as Section[]

    const docs = db.prepare('SELECT * FROM documents WHERE feature_id = ?').all(id) as DocumentRow[]

    // 检测游离文档：有 documents 记录但 section_key 不在当前 sections 中（_default 除外）
    const sectionKeys = new Set(sections.map(s => s.key))
    const orphaned = docs
      .filter(d => !sectionKeys.has(d.section_key) && d.section_key !== '_default')
      .map(d => ({
        key: d.section_key,
        status: d.status || 'draft',
        assignees: d.assignees || '[]',
        reviewNote: d.review_note || '',
        reviewStep: d.review_step || 0,
        reviewLog: d.review_log || '[]',
        updated_at: d.updated_at,
      }))

    return success({
      ...feature,
      sections: sections.map((s: Section) => {
        const doc = docs.find((d: DocumentRow) => d.section_key === s.key)
        return {
          ...s,
          status: doc?.status || 'draft',
          assignees: doc?.assignees || '[]',
          reviewNote: doc?.review_note || '',
          reviewStep: doc?.review_step || 0,
          reviewLog: doc?.review_log || '[]',
        }
      }),
      orphaned,
      is_custom: !!feature.is_custom,
    })
  })

  // 创建自定义主题（项目 pm 可操作）
  app.post('/api/v1/features', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const body = req.body as CreateFeatureBody
    const sections = body.sections || []
    if (!body.title?.trim()) return fail(reply, 400, '主题名称不能为空')

    const projectId = body.projectId || 'default'
    const userId = req.user!.userId
    const role = req.user!.role
    if (!hasProjectRole(userId, role, projectId, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    const id = `custom:${uuid().slice(0, 8)}`
    const db = getDb()

    db.prepare(`
      INSERT INTO features (id, title, description, sections, is_custom, category_id, project_id)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(id, body.title.trim(), body.description || '', JSON.stringify(sections), body.categoryId || null, projectId)

    return created(id)
  })

  // 更新主题（项目 pm 可操作）
  app.put('/api/v1/features/:id', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as UpdateFeatureBody
    const db = getDb()
    const sections = body.sections || []

    const feature = db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
    if (!feature) return fail(reply, 404, 'Not found')
    if (!body.title?.trim()) return fail(reply, 400, '主题名称不能为空')

    const userId = req.user!.userId
    const role = req.user!.role
    if (!hasProjectRole(userId, role, feature.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    db.prepare(`
      UPDATE features SET title = ?, description = ?, sections = ?, category_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(body.title.trim(), body.description || '', JSON.stringify(sections), body.categoryId || null, id)

    return ok()
  })

  // 删除主题（项目 pm 可操作）
  app.delete('/api/v1/features/:id', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const feature = db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
    if (!feature) return fail(reply, 404, 'Not found')

    const userId = req.user!.userId
    const role = req.user!.role
    if (!hasProjectRole(userId, role, feature.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    db.prepare('DELETE FROM features WHERE id = ?').run(id)
    return ok()
  })

  // 更新 section 状态（writer+ 可提交审核，pm 可审核）
  app.put('/api/v1/features/:id/sections/:sectionKey/status', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id: featureId, sectionKey } = req.params as { id: string; sectionKey: string }
    const { status, assignees, reviewNote, direct } = req.body as UpdateSectionStatusBody
    const db = getDb()
    const userId = req.user!.userId
    const userRole = req.user!.role
    const dbUser = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as { display_name: string } | undefined
    const reviewerName = dbUser?.display_name || req.user?.displayName || '未知用户'

    const projectId = getFeatureProjectId(featureId)
    if (!projectId) {
      return fail(reply, 404, '主题不存在')
    }
    if (!isProjectMember(userId, userRole, projectId)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    const docId = `${featureId}/${sectionKey}`
    const existingDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as DocumentRow | undefined

    // 确保 document 存在
    if (!existingDoc) {
      db.prepare(
        'INSERT INTO documents (id, feature_id, section_key, status, assignees, review_note, review_step, review_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(docId, featureId, sectionKey, 'draft', '[]', '', 0, '[]')
    }

    // 获取有效审核链
    const reviewChain = getEffectiveReviewChain(projectId)
    const currentStep = existingDoc?.review_step ?? 0
    const reviewLog = JSON.parse(existingDoc?.review_log || '[]') as { action: string; reviewerId: string; note: string; step: number; createdAt: string }[]

    // ====== 分支处理 ======

    // 指派更新（需要 pm 权限）
    if (assignees !== undefined) {
      if (!hasProjectRole(userId, userRole, projectId, 'pm')) {
        return fail(reply, 403, '项目内权限不足，只有项目管理员可以指派编写人')
      }
      const oldAssignees: string[] = JSON.parse(existingDoc?.assignees || '[]')
      db.prepare('UPDATE documents SET assignees = ? WHERE id = ?').run(JSON.stringify(assignees), docId)
      // 通知新增的被指派人
      const added = assignees.filter(a => !oldAssignees.includes(a))
      if (added.length > 0) {
        notifyAssignees(featureId, sectionKey, added, reviewerName)
          .catch((e: unknown) => app.log.error(`飞书通知失败(指派) ${e instanceof Error ? e.message : e}`))
      }
      // 通知被移除的编写人
      const removed = oldAssignees.filter(a => !assignees.includes(a))
      for (const uid of removed) {
        notifyRemoveAssignee(featureId, sectionKey, uid, reviewerName)
          .catch((e: unknown) => app.log.error(`飞书通知失败(移除指派) ${e instanceof Error ? e.message : e}`))
      }
    }

    // 审核批注更新（不改变状态）
    if (reviewNote !== undefined && !status) {
      db.prepare("UPDATE documents SET review_note = ?, updated_at = datetime('now') WHERE id = ?").run(reviewNote || '', docId)
    }

    // 提交审核（writer+ 可操作）
    if (status === 'pending_review') {
      if (reviewChain.length === 0) {
        return fail(reply, 400, '该项目没有可审核的 PM，请先添加 PM 成员')
      }
      db.prepare("UPDATE documents SET status = 'pending_review', review_step = 0, updated_at = datetime('now') WHERE id = ?").run(docId)
      notifyNextReviewer(featureId, sectionKey, reviewChain[0], 1, reviewChain.length, reviewerName)
        .catch((e: unknown) => app.log.error(`飞书通知失败(提交) ${e instanceof Error ? e.message : e}`))
    }

    // 审核通过（pm only）
    if (status === 'approved') {
      if (!hasProjectRole(userId, userRole, projectId, 'pm')) {
        return fail(reply, 403, '项目内权限不足，只有项目管理员可以审核')
      }
      // 直接通过：跳过审核链校验
      if (!direct) {
        const currentReviewerId = reviewChain[currentStep]
        if (currentReviewerId && currentReviewerId !== userId) {
          return fail(reply, 403, '当前不是你审核')
        }
      }

      const logEntry = {
        action: 'approved' as const,
        reviewerId: userId,
        note: direct ? '直接通过（跳过审核流程）' : (reviewNote || ''),
        step: direct ? -1 : currentStep,
        createdAt: new Date().toISOString(),
      }
      reviewLog.push(logEntry)

      if (direct) {
        // 直接通过：直接设为 approved
        db.prepare("UPDATE documents SET status = 'approved', review_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(reviewLog), '', docId)
        const docAssignees = JSON.parse(existingDoc?.assignees || '[]') as string[]
        if (docAssignees.length > 0) {
          notifyDirectApprove(featureId, sectionKey, reviewerName, docAssignees, userId)
            .catch((e: unknown) => app.log.error(`飞书通知失败(直接通过) ${e instanceof Error ? e.message : e}`))
        }
      } else {
        const newStep = currentStep + 1
        if (newStep >= reviewChain.length) {
          // 全部审核通过
          db.prepare("UPDATE documents SET status = 'approved', review_step = ?, review_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
            .run(newStep, JSON.stringify(reviewLog), reviewNote || '', docId)
          const docAssignees = JSON.parse(existingDoc?.assignees || '[]') as string[]
          if (docAssignees.length > 0) {
            notifyWriterReviewResult(featureId, sectionKey, 'approved', reviewNote || '', reviewerName, docAssignees, userId)
              .catch((e: unknown) => app.log.error(`飞书通知失败(通过) ${e instanceof Error ? e.message : e}`))
          }
        } else {
          // 推进到下一步
          db.prepare("UPDATE documents SET review_step = ?, review_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
            .run(newStep, JSON.stringify(reviewLog), reviewNote || '', docId)
          notifyNextReviewer(featureId, sectionKey, reviewChain[newStep], newStep + 1, reviewChain.length, reviewerName)
            .catch((e: unknown) => app.log.error(`飞书通知失败(推进) ${e instanceof Error ? e.message : e}`))
        }
      }
    }

    // 退回修改（pm only）
    if (status === 'rejected') {
      if (!hasProjectRole(userId, userRole, projectId, 'pm')) {
        return fail(reply, 403, '项目内权限不足，只有项目管理员可以审核')
      }
      const currentReviewerId = reviewChain[currentStep]
      if (currentReviewerId && currentReviewerId !== userId) {
        return fail(reply, 403, '当前不是你审核')
      }
      if (!reviewNote?.trim()) {
        return fail(reply, 400, '退回必须填写理由')
      }

      const logEntry = {
        action: 'rejected' as const,
        reviewerId: userId,
        note: reviewNote,
        step: currentStep,
        createdAt: new Date().toISOString(),
      }
      reviewLog.push(logEntry)

      db.prepare("UPDATE documents SET status = 'rejected', review_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(reviewLog), reviewNote, docId)

      const docAssignees = JSON.parse(existingDoc?.assignees || '[]') as string[]
      if (docAssignees.length > 0) {
        notifyWriterReviewResult(featureId, sectionKey, 'rejected', reviewNote, reviewerName, docAssignees, userId)
          .catch((e: unknown) => app.log.error(`飞书通知失败(退回) ${e instanceof Error ? e.message : e}`))
      }
    }

    // 状态重置（pm only）
    if (status === 'draft' || status === 'in_progress') {
      if (!hasProjectRole(userId, userRole, projectId, 'pm')) {
        return fail(reply, 403, '项目内权限不足，只有项目管理员可以重置状态')
      }
      db.prepare("UPDATE documents SET status = ?, review_step = 0, updated_at = datetime('now') WHERE id = ?").run(status, docId)
      const docAssignees = JSON.parse(existingDoc?.assignees || '[]') as string[]
      if (docAssignees.length > 0) {
        notifyStatusReset(featureId, sectionKey, status, reviewerName, docAssignees, userId)
          .catch((e: unknown) => app.log.error(`飞书通知失败(重置) ${e instanceof Error ? e.message : e}`))
      }
    }

    return ok()
  })

  // 删除游离文档（pm only）
  app.delete('/api/v1/features/:id/orphaned/:sectionKey', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id: featureId, sectionKey } = req.params as { id: string; sectionKey: string }
    const db = getDb()

    const projectId = getFeatureProjectId(featureId)
    const userId = req.user!.userId
    const role = req.user!.role
    if (projectId && !hasProjectRole(userId, role, projectId, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    const docId = `${featureId}/${sectionKey}`
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId)
    // 级联删除 document_updates 和 document_snapshots
    return ok()
  })

  // 更新 sections（排序/增删），pm only
  app.put('/api/v1/features/:id/sections', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as UpdateSectionsBody
    const sections = body.sections || []

    const db = getDb()
    const feature = db.prepare('SELECT id, project_id FROM features WHERE id = ?').get(id) as Pick<FeatureRow, 'id' | 'project_id'> | undefined
    if (!feature) return fail(reply, 404, 'Not found')

    const userId = req.user!.userId
    const userRole = req.user!.role
    if (!hasProjectRole(userId, userRole, feature.project_id, 'pm')) {
      return fail(reply, 403, '项目内权限不足')
    }

    db.prepare("UPDATE features SET sections = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(sections), id)

    return success({ sections })
  })
}