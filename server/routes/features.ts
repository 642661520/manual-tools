import { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { isProjectMember } from '../auth/membership.js'
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
  ImportFeatureItem,
  ImportApplyBody,
} from '../types.js'

type Section = { key: string; title: string; description?: string }

/** 辅助：从 feature 记录获取 project_id */
function getFeatureProjectId(featureId: string): string | null {
  const db = getDb()
  const feature = db.prepare('SELECT project_id FROM features WHERE id = ?').get(featureId) as { project_id: string } | undefined
  return feature?.project_id || null
}

/** 获取项目的有效审核链（配置的或默认的） */
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
    WHERE pm.project_id = ? AND u.role = 'pm'
    ORDER BY u.display_name
  `).all(projectId) as { id: string }[]
  return pms.map(p => p.id)
}

export async function featureRoutes(app: FastifyInstance) {
  // 获取所有主题（含状态摘要），支持按项目过滤
  app.get('/api/features', { preHandler: authMiddleware }, async (req) => {
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
           AND d.section_key NOT IN (SELECT json_extract(value, '$.key') FROM json_each(f.sections))),
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
    return features
  })

  // 获取单个主题
  app.get('/api/features/:id', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const feature = db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
    if (!feature) return { error: 'Not found' }

    let sections = JSON.parse(feature.sections || '[]') as Section[]
    // 旧数据兼容：无章节的自动生成默认章节
    if (sections.length === 0) {
      sections = [{ key: 'main', title: '正文' }]
      db.prepare("UPDATE features SET sections = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(sections), id)
    }

    const docs = db.prepare('SELECT * FROM documents WHERE feature_id = ?').all(id) as DocumentRow[]

    // 检测游离文档：有 documents 记录但 section_key 不在当前 sections 中
    const sectionKeys = new Set(sections.map(s => s.key))
    const orphaned = docs
      .filter(d => !sectionKeys.has(d.section_key))
      .map(d => ({
        key: d.section_key,
        status: d.status || 'draft',
        assignees: d.assignees || '[]',
        reviewNote: d.review_note || '',
        reviewStep: d.review_step || 0,
        reviewLog: d.review_log || '[]',
        updated_at: d.updated_at,
      }))

    return {
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
    }
  })

  // 创建自定义主题
  app.post('/api/features', { preHandler: [authMiddleware, requireRole('ops', 'pm')] }, async (req, reply) => {
    const body = req.body as CreateFeatureBody
    const sections = body.sections || []
    if (!body.title?.trim()) return reply.status(400).send({ error: '主题名称不能为空' })
    if (sections.length === 0) return reply.status(400).send({ error: '至少需要一个章节' })

    const projectId = body.projectId || 'default'
    if (!isProjectMember(req.user!.userId, req.user!.role, projectId)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    const id = `custom:${uuid().slice(0, 8)}`
    const db = getDb()

    db.prepare(`
      INSERT INTO features (id, title, description, sections, is_custom, category_id, project_id)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(id, body.title.trim(), body.description || '', JSON.stringify(sections), body.categoryId || null, projectId)

    return { id }
  })

  // 更新主题
  app.put('/api/features/:id', { preHandler: [authMiddleware, requireRole('ops', 'pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as UpdateFeatureBody
    const db = getDb()
    const sections = body.sections || []

    const feature = db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
    if (!feature) return reply.status(404).send({ error: 'Not found' })
    if (!body.title?.trim()) return reply.status(400).send({ error: '主题名称不能为空' })
    if (sections.length === 0) return reply.status(400).send({ error: '至少需要一个章节' })

    if (!isProjectMember(req.user!.userId, req.user!.role, feature.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    db.prepare(`
      UPDATE features SET title = ?, description = ?, sections = ?, category_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(body.title.trim(), body.description || '', JSON.stringify(sections), body.categoryId || null, id)

    return { ok: true }
  })

  // 删除主题
  app.delete('/api/features/:id', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const feature = db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
    if (!feature) return reply.status(404).send({ error: 'Not found' })

    if (!isProjectMember(req.user!.userId, req.user!.role, feature.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    db.prepare('DELETE FROM features WHERE id = ?').run(id)
    return { ok: true }
  })

  // 导入：差异检测
  app.post('/api/features/import', { preHandler: [authMiddleware, requireRole('ops', 'pm')] }, async (req, reply) => {
    const { projectId } = req.query as { projectId?: string }
    const effectiveProjectId = projectId || 'default'
    if (!isProjectMember(req.user!.userId, req.user!.role, effectiveProjectId)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }
    const body = req.body as { features: ImportFeatureItem[] }
    const imported = body.features || []
    const db = getDb()

    // 仅获取当前项目中的代码导入主题进行对比
    const existing = projectId
      ? db.prepare('SELECT * FROM features WHERE is_custom = 0 AND project_id = ?').all(projectId) as FeatureRow[]
      : db.prepare('SELECT * FROM features WHERE is_custom = 0').all() as FeatureRow[]

    const existingMap = new Map(existing.map((f: FeatureRow) => [f.id, f]))
    const importedMap = new Map(imported.map(f => [f.id, f]))

    const added: ImportFeatureItem[] = []
    const modified: { before: FeatureRow; after: ImportFeatureItem; changes: string[] }[] = []
    const removed: (FeatureRow & { has_content: boolean })[] = []

    for (const f of imported) {
      const ex = existingMap.get(f.id)
      if (!ex) {
        added.push(f)
      } else {
        const changes: string[] = []
        if (ex.title !== f.title) changes.push('title')
        if (ex.description !== f.description) changes.push('description')
        if (ex.sections !== JSON.stringify(f.sections || [])) changes.push('sections')
        if (changes.length > 0) {
          modified.push({ before: ex, after: f, changes })
        }
      }
    }

    for (const ex of existing) {
      if (!importedMap.has(ex.id)) {
        const hasContent = db.prepare(
          'SELECT COUNT(*) as cnt FROM documents WHERE feature_id = ?'
        ).get(ex.id) as HasContentRow | undefined
        removed.push({ ...ex, has_content: (hasContent?.cnt ?? 0) > 0 })
      }
    }

    return { added, modified, removed, total: imported.length }
  })

  // 导入：确认执行
  app.post('/api/features/import/apply', { preHandler: [authMiddleware, requireRole('pm')] }, async (req, reply) => {
    const { projectId } = req.query as { projectId?: string }
    const effectiveProjectId = projectId || 'default'
    if (!isProjectMember(req.user!.userId, req.user!.role, effectiveProjectId)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }
    const body = req.body as ImportApplyBody
    const features = body.features || []
    const removeIds = body.removeIds || []
    const db = getDb()

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO features (id, title, description, sections, is_custom, updated_at, project_id)
      VALUES (?, ?, ?, ?, 0, datetime('now'), ?)
    `)

    for (const f of features) {
      insertStmt.run(f.id, f.title, f.description, JSON.stringify(f.sections || []), effectiveProjectId)
    }

    for (const id of removeIds) {
      db.prepare('DELETE FROM features WHERE id = ? AND is_custom = 0').run(id)
    }

    return { ok: true }
  })

  // 更新 section 状态（多人指派 + 串行审核链）
  app.put('/api/features/:id/sections/:sectionKey/status', { preHandler: [authMiddleware, requireRole('ops', 'pm')] }, async (req, reply) => {
    const { id: featureId, sectionKey } = req.params as { id: string; sectionKey: string }
    const { status, assignees, reviewNote, direct } = req.body as UpdateSectionStatusBody
    const db = getDb()
    const userId = req.user!.userId
    const dbUser = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as { display_name: string } | undefined
    const reviewerName = dbUser?.display_name || req.user?.displayName || '未知用户'

    const projectId = getFeatureProjectId(featureId)
    if (!projectId) {
      return reply.status(404).send({ error: '主题不存在' })
    }
    if (!isProjectMember(userId, req.user!.role, projectId)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
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
    const reviewLog = JSON.parse(existingDoc?.review_log || '[]') as { action: string; reviewerId: string; note: string; step: number; created_at: string }[]

    // ====== 分支处理 ======

    // 指派更新
    if (assignees !== undefined) {
      const oldAssignees: string[] = JSON.parse(existingDoc?.assignees || '[]')
      db.prepare('UPDATE documents SET assignees = ? WHERE id = ?').run(JSON.stringify(assignees), docId)
      // 通知新增的被指派人
      const added = assignees.filter(a => !oldAssignees.includes(a))
      if (added.length > 0) {
        notifyAssignees(featureId, sectionKey, added, reviewerName)
          .catch(e => console.error('飞书通知失败(指派):', e))
      }
      // 通知被移除的编写人
      const removed = oldAssignees.filter(a => !assignees.includes(a))
      for (const uid of removed) {
        notifyRemoveAssignee(featureId, sectionKey, uid, reviewerName)
          .catch(e => console.error('飞书通知失败(移除指派):', e))
      }
    }

    // 审核批注更新（不改变状态）
    if (reviewNote !== undefined && !status) {
      db.prepare("UPDATE documents SET review_note = ?, updated_at = datetime('now') WHERE id = ?").run(reviewNote || '', docId)
    }

    // 提交审核
    if (status === 'pending_review') {
      if (reviewChain.length === 0) {
        return reply.status(400).send({ error: '该项目没有可审核的 PM，请先添加 PM 成员' })
      }
      db.prepare("UPDATE documents SET status = 'pending_review', review_step = 0, updated_at = datetime('now') WHERE id = ?").run(docId)
      notifyNextReviewer(featureId, sectionKey, reviewChain[0], 1, reviewChain.length, reviewerName)
        .catch(e => console.error('飞书通知失败(提交):', e))
    }

    // 审核通过
    if (status === 'approved') {
      // 直接通过：跳过审核链校验
      if (!direct) {
        const currentReviewerId = reviewChain[currentStep]
        if (currentReviewerId && currentReviewerId !== userId) {
          return reply.status(403).send({ error: '当前不是你审核' })
        }
      }

      const logEntry = {
        action: 'approved' as const,
        reviewerId: userId,
        note: direct ? '直接通过（跳过审核流程）' : (reviewNote || ''),
        step: direct ? -1 : currentStep,
        created_at: new Date().toISOString(),
      }
      reviewLog.push(logEntry)

      if (direct) {
        // 直接通过：直接设为 approved
        db.prepare("UPDATE documents SET status = 'approved', review_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(reviewLog), '', docId)
        const docAssignees = JSON.parse(existingDoc?.assignees || '[]') as string[]
        if (docAssignees.length > 0) {
          notifyDirectApprove(featureId, sectionKey, reviewerName, docAssignees, userId)
            .catch(e => console.error('飞书通知失败(直接通过):', e))
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
              .catch(e => console.error('飞书通知失败(通过):', e))
          }
        } else {
          // 推进到下一步
          db.prepare("UPDATE documents SET review_step = ?, review_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
            .run(newStep, JSON.stringify(reviewLog), reviewNote || '', docId)
          notifyNextReviewer(featureId, sectionKey, reviewChain[newStep], newStep + 1, reviewChain.length, reviewerName)
            .catch(e => console.error('飞书通知失败(推进):', e))
        }
      }
    }

    // 退回修改
    if (status === 'rejected') {
      const currentReviewerId = reviewChain[currentStep]
      if (currentReviewerId && currentReviewerId !== userId) {
        return reply.status(403).send({ error: '当前不是你审核' })
      }
      if (!reviewNote?.trim()) {
        return reply.status(400).send({ error: '退回必须填写理由' })
      }

      const logEntry = {
        action: 'rejected' as const,
        reviewerId: userId,
        note: reviewNote,
        step: currentStep,
        created_at: new Date().toISOString(),
      }
      reviewLog.push(logEntry)

      db.prepare("UPDATE documents SET status = 'rejected', review_log = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(reviewLog), reviewNote, docId)

      const docAssignees = JSON.parse(existingDoc?.assignees || '[]') as string[]
      if (docAssignees.length > 0) {
        notifyWriterReviewResult(featureId, sectionKey, 'rejected', reviewNote, reviewerName, docAssignees, userId)
          .catch(e => console.error('飞书通知失败(退回):', e))
      }
    }

    // 状态重置（PM 强制重置，不需要链校验）
    if (status === 'draft' || status === 'in_progress') {
      db.prepare("UPDATE documents SET status = ?, review_step = 0, updated_at = datetime('now') WHERE id = ?").run(status, docId)
      const docAssignees = JSON.parse(existingDoc?.assignees || '[]') as string[]
      if (docAssignees.length > 0) {
        notifyStatusReset(featureId, sectionKey, status, reviewerName, docAssignees, userId)
          .catch(e => console.error('飞书通知失败(重置):', e))
      }
    }

    return { ok: true }
  })

  // 删除游离文档
  app.delete('/api/features/:id/orphaned/:sectionKey', { preHandler: [authMiddleware, requireRole('ops', 'pm')] }, async (req, reply) => {
    const { id: featureId, sectionKey } = req.params as { id: string; sectionKey: string }
    const db = getDb()

    const projectId = getFeatureProjectId(featureId)
    if (projectId && !isProjectMember(req.user!.userId, req.user!.role, projectId)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    const docId = `${featureId}/${sectionKey}`
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId)
    // 级联删除 document_updates 和 document_snapshots
    return { ok: true }
  })

  // 更新 sections（排序/增删），适用于所有主题
  app.put('/api/features/:id/sections', { preHandler: [authMiddleware, requireRole('ops', 'pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as UpdateSectionsBody
    const sections = body.sections || []
    if (sections.length === 0) return reply.status(400).send({ error: '至少需要一个章节' })

    const db = getDb()
    const feature = db.prepare('SELECT id, project_id FROM features WHERE id = ?').get(id) as Pick<FeatureRow, 'id' | 'project_id'> | undefined
    if (!feature) return reply.status(404).send({ error: 'Not found' })

    if (!isProjectMember(req.user!.userId, req.user!.role, feature.project_id)) {
      return reply.status(403).send({ error: '你不是该项目的成员' })
    }

    db.prepare("UPDATE features SET sections = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(sections), id)

    return { ok: true, sections }
  })
}
