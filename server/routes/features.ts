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
  CreateFeatureBody,
  UpdateFeatureBody,
  UpdateSectionStatusBody,
  UpdateSectionsBody,
} from '../types.js'
import { featureSchema } from '../lib/swagger.js'

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
  // 获取所有章节（含状态摘要），支持按项目过滤
  app.get('/api/v1/features', {
    preHandler: authMiddleware,
    schema: {
      tags: ['features'],
      description: '获取功能列表（含文档状态统计），支持 ?projectId= 过滤',
      querystring: {
        type: 'object',
        properties: { projectId: { type: 'string', description: '项目 ID（可选）' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', const: true },
            data: { type: 'array', items: featureSchema },
          },
        },
      },
    },
  }, async (req) => {
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

  // 获取单个章节
  app.get('/api/v1/features/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const feature = db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
    if (!feature) return fail(reply, 404, 'Not found')

    // 检查项目成员身份
    if (!isProjectMember(req.user!.userId, req.user!.role, feature.project_id)) {
      return fail(reply, 403, '你不是该项目的成员')
    }

    const sections = JSON.parse(feature.sections || '[]') as Section[]

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
        statusLog: d.status_log || '[]',
        updated_at: d.updated_at,
      }))

    // _default 节数据（当 feature 无显式 section 时的默认小节）
    const defaultDoc = docs.find((d: DocumentRow) => d.section_key === '_default')
    const defaultSection = defaultDoc ? {
      key: '_default',
      title: feature.title || '正文',
      description: '',
      status: defaultDoc.status || 'draft',
      assignees: defaultDoc.assignees || '[]',
      reviewNote: defaultDoc.review_note || '',
      reviewStep: defaultDoc.review_step || 0,
      statusLog: defaultDoc.status_log || '[]',
    } : null

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
          statusLog: doc?.status_log || '[]',
        }
      }),
      orphaned,
      defaultSection,
      is_custom: !!feature.is_custom,
    })
  })

  // 创建自定义章节（项目 pm 可操作）
  app.post('/api/v1/features', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const body = req.body as CreateFeatureBody
    const sections = body.sections || []
    if (!body.title?.trim()) return fail(reply, 400, '章节名称不能为空')

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

  // 更新章节（项目 pm 可操作）
  app.put('/api/v1/features/:id', { preHandler: [authMiddleware, requireRole('admin', 'member')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as UpdateFeatureBody
    const db = getDb()
    const sections = body.sections || []

    const feature = db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
    if (!feature) return fail(reply, 404, 'Not found')
    if (!body.title?.trim()) return fail(reply, 400, '章节名称不能为空')

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

  // 删除章节（项目 pm 可操作）
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

    // 1) 基础校验（事务外）
    const projectId = getFeatureProjectId(featureId)
    if (!projectId) return fail(reply, 404, '章节不存在')
    if (!isProjectMember(userId, userRole, projectId)) return fail(reply, 403, '你不是该项目的成员')

    const reviewChain = getEffectiveReviewChain(projectId)
    const docId = `${featureId}/${sectionKey}`

    // 预读当前文档状态（用于权限校验和后续通知）
    const existingDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as DocumentRow | undefined
    const currentStep = existingDoc?.review_step ?? 0
    const oldAssignees: string[] = JSON.parse(existingDoc?.assignees || '[]')

    // 2) 所有权限校验（事务外，提前 fail，避免部分提交）
    if (assignees !== undefined && !hasProjectRole(userId, userRole, projectId, 'pm')) {
      return fail(reply, 403, '项目内权限不足，只有项目管理员可以指派编写人')
    }
    if (status === 'pending_review' && reviewChain.length === 0) {
      return fail(reply, 400, '该项目没有可审核的 PM，请先添加 PM 成员')
    }
    if (status === 'approved') {
      if (!hasProjectRole(userId, userRole, projectId, 'pm')) {
        return fail(reply, 403, '项目内权限不足，只有项目管理员可以审核')
      }
      if (!direct) {
        const currentReviewerId = reviewChain[currentStep]
        if (currentReviewerId && currentReviewerId !== userId) {
          return fail(reply, 403, '当前不是你审核')
        }
      }
    }
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
    }
    if ((status === 'draft' || status === 'in_progress') && !hasProjectRole(userId, userRole, projectId, 'pm')) {
      return fail(reply, 403, '项目内权限不足，只有项目管理员可以重置状态')
    }

    // 3) 事务：纯 DB 写入（不再含 fail() 调用）
    const dbUser = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as { display_name: string } | undefined
    const operatorName = dbUser?.display_name || req.user?.displayName || '未知用户'

    interface NotificationJob { (): Promise<void> }
    const jobs: NotificationJob[] = []

    const result = db.transaction(() => {
      // 确保 document 存在
      const doc = db.prepare('SELECT id, status_log, assignees FROM documents WHERE id = ?').get(docId) as { id: string; status_log: string; assignees: string } | undefined
      if (!doc) {
        db.prepare(
          'INSERT INTO documents (id, feature_id, section_key, status, assignees, review_note, review_step, status_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(docId, featureId, sectionKey, 'draft', '[]', '', 0, '[]')
      }

      const statusLog = JSON.parse(doc?.status_log || '[]') as { action: string; userId: string; note: string; step: number; createdAt: string }[]

      /** 追加一条状态变更记录 */
      function addLog(action: string, note: string, step: number) {
        statusLog.push({
          action,
          userId,
          note,
          step,
          createdAt: new Date().toISOString(),
        })
      }

      // 指派更新
      if (assignees !== undefined) {
        db.prepare('UPDATE documents SET assignees = ? WHERE id = ?').run(JSON.stringify(assignees), docId)
        const added = assignees.filter((a: string) => !oldAssignees.includes(a))
        if (added.length > 0) {
          jobs.push(() => notifyAssignees(featureId, sectionKey, added, operatorName).catch(
            (e: unknown) => app.log.error(`飞书通知失败(指派) ${e instanceof Error ? e.message : e}`)))
        }
        const removed = oldAssignees.filter((a: string) => !assignees.includes(a))
        for (const uid of removed) {
          jobs.push(() => notifyRemoveAssignee(featureId, sectionKey, uid, operatorName).catch(
            (e: unknown) => app.log.error(`飞书通知失败(移除指派) ${e instanceof Error ? e.message : e}`)))
        }
      }

      // 审核批注更新（不改变状态）
      if (reviewNote !== undefined && !status) {
        db.prepare("UPDATE documents SET review_note = ?, updated_at = datetime('now') WHERE id = ?").run(reviewNote || '', docId)
        return ok()
      }

      // 提交审核
      if (status === 'pending_review') {
        addLog('submitted', '', 0)
        db.prepare("UPDATE documents SET status = 'pending_review', review_step = 0, status_log = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(statusLog), docId)
        jobs.push(() => notifyNextReviewer(featureId, sectionKey, reviewChain[0], 1, reviewChain.length, operatorName).catch(
          (e: unknown) => app.log.error(`飞书通知失败(提交) ${e instanceof Error ? e.message : e}`)))
        return ok()
      }

      // 审核通过
      if (status === 'approved') {
        if (direct) {
          addLog('direct_approved', '直接通过（跳过审核流程）', -1)
          db.prepare("UPDATE documents SET status = 'approved', status_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
            .run(JSON.stringify(statusLog), '', docId)
          if (oldAssignees.length > 0) {
            jobs.push(() => notifyDirectApprove(featureId, sectionKey, operatorName, oldAssignees, userId).catch(
              (e: unknown) => app.log.error(`飞书通知失败(直接通过) ${e instanceof Error ? e.message : e}`)))
          }
        } else {
          const newStep = currentStep + 1
          addLog('approved', reviewNote || '', currentStep)
          if (newStep >= reviewChain.length) {
            db.prepare("UPDATE documents SET status = 'approved', review_step = ?, status_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
              .run(newStep, JSON.stringify(statusLog), reviewNote || '', docId)
            if (oldAssignees.length > 0) {
              jobs.push(() => notifyWriterReviewResult(featureId, sectionKey, 'approved', reviewNote || '', operatorName, oldAssignees, userId).catch(
                (e: unknown) => app.log.error(`飞书通知失败(通过) ${e instanceof Error ? e.message : e}`)))
            }
          } else {
            db.prepare("UPDATE documents SET review_step = ?, status_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
              .run(newStep, JSON.stringify(statusLog), reviewNote || '', docId)
            jobs.push(() => notifyNextReviewer(featureId, sectionKey, reviewChain[newStep], newStep + 1, reviewChain.length, operatorName).catch(
              (e: unknown) => app.log.error(`飞书通知失败(推进) ${e instanceof Error ? e.message : e}`)))
          }
        }
        return ok()
      }

      // 退回修改
      if (status === 'rejected') {
        addLog('rejected', reviewNote!, currentStep)
        db.prepare("UPDATE documents SET status = 'rejected', status_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(statusLog), reviewNote!, docId)
        if (oldAssignees.length > 0) {
          jobs.push(() => notifyWriterReviewResult(featureId, sectionKey, 'rejected', reviewNote!, operatorName, oldAssignees, userId).catch(
            (e: unknown) => app.log.error(`飞书通知失败(退回) ${e instanceof Error ? e.message : e}`)))
        }
        return ok()
      }

      // 状态重置
      if (status === 'draft' || status === 'in_progress') {
        addLog(status === 'draft' ? 'reset_to_draft' : 'reset_to_in_progress', '', 0)
        db.prepare("UPDATE documents SET status = ?, review_step = 0, status_log = ?, updated_at = datetime('now') WHERE id = ?")
          .run(status, JSON.stringify(statusLog), docId)
        if (oldAssignees.length > 0) {
          jobs.push(() => notifyStatusReset(featureId, sectionKey, status, operatorName, oldAssignees, userId).catch(
            (e: unknown) => app.log.error(`飞书通知失败(重置) ${e instanceof Error ? e.message : e}`)))
        }
        return ok()
      }

      return ok()
    })() // db.transaction() 立即执行

    // 4) 异步通知（事务外 fire-and-forget，避免阻塞响应）
    jobs.forEach(job => job())

    return result
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