import { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { authMiddleware } from '../auth/middleware.js'
import { isProjectMember } from '../auth/membership.js'
import type { DocumentRow } from '../types.js'
import { success, fail } from '../lib/response.js'

interface TodoItem {
  docId: string
  featureId: string
  featureTitle: string
  sectionKey: string
  sectionTitle: string
  status: string
  reviewNote: string
  reviewStep: number
  todoType: 'write' | 'review'
}

export async function todoRoutes(app: FastifyInstance) {
  app.get('/api/v1/todos', { preHandler: authMiddleware }, async (req, reply) => {
    const { projectId } = req.query as { projectId?: string }
    const db = getDb()
    const userId = req.user!.userId
    const userRole = req.user!.role

    // member 角色：检查项目成员权限
    if (userRole === 'member') {
      if (projectId) {
        if (!isProjectMember(userId, userRole, projectId)) {
          return fail(reply, 403, '非项目成员无法查看')
        }
      }
    }

    const todos: TodoItem[] = []

    // 查询项目下的文档
    let docs: (DocumentRow & { feature_title: string; feature_project_id: string })[]
    if (projectId) {
      docs = db
        .prepare(`
        SELECT d.*, f.title as feature_title, f.project_id as feature_project_id
        FROM documents d
        JOIN features f ON f.id = d.feature_id
        WHERE f.project_id = ?
        ORDER BY f.title, d.section_key
      `)
        .all(projectId) as (DocumentRow & { feature_title: string; feature_project_id: string })[]
    } else if (userRole === 'member') {
      docs = db
        .prepare(`
        SELECT d.*, f.title as feature_title, f.project_id as feature_project_id
        FROM documents d
        JOIN features f ON f.id = d.feature_id
        JOIN project_members pm ON f.project_id = pm.project_id AND pm.user_id = ?
        ORDER BY f.title, d.section_key
      `)
        .all(userId) as (DocumentRow & { feature_title: string; feature_project_id: string })[]
    } else {
      docs = db
        .prepare(`
        SELECT d.*, f.title as feature_title, f.project_id as feature_project_id
        FROM documents d
        JOIN features f ON f.id = d.feature_id
        ORDER BY f.title, d.section_key
      `)
        .all() as (DocumentRow & { feature_title: string; feature_project_id: string })[]
    }

    // 缓存 feature sections
    const sectionCache = new Map<string, { key: string; title: string }[]>()

    function getSectionTitle(featureId: string, sectionKey: string): string {
      if (sectionKey === '_default') return '正文'
      if (!sectionCache.has(featureId)) {
        const f = db.prepare('SELECT sections FROM features WHERE id = ?').get(featureId) as
          | { sections: string }
          | undefined
        sectionCache.set(
          featureId,
          f ? (JSON.parse(f.sections || '[]') as { key: string; title: string }[]) : [],
        )
      }
      const sec = sectionCache.get(featureId)!.find((s) => s.key === sectionKey)
      return sec ? sec.title : sectionKey
    }

    // 缓存项目审核链
    const reviewChainCache = new Map<string, string[]>()

    function getReviewerAtStep(projectId: string, step: number): string | null {
      if (!reviewChainCache.has(projectId)) {
        const project = db
          .prepare('SELECT review_chain FROM projects WHERE id = ?')
          .get(projectId) as { review_chain: string } | undefined
        if (project) {
          try {
            reviewChainCache.set(projectId, JSON.parse(project.review_chain || '[]') as string[])
          } catch {
            reviewChainCache.set(projectId, [])
          }
        } else {
          // fallback: 项目所有 PM（查 project_members.role = 'pm'）
          const pms = db
            .prepare(`
            SELECT u.id FROM users u
            JOIN project_members pm ON u.id = pm.user_id
            WHERE pm.project_id = ? AND pm.role = 'pm'
          `)
            .all(projectId) as { id: string }[]
          reviewChainCache.set(
            projectId,
            pms.map((p) => p.id),
          )
        }
      }
      const chain = reviewChainCache.get(projectId)!
      return step < chain.length ? chain[step] : null
    }

    for (const doc of docs) {
      try {
        const assignees: string[] = JSON.parse(doc.assignees || '[]')

        // 1. 编写任务：当前用户被指派
        if (assignees.includes(userId)) {
          todos.push({
            docId: doc.id,
            featureId: doc.feature_id,
            featureTitle: doc.feature_title,
            sectionKey: doc.section_key,
            sectionTitle: getSectionTitle(doc.feature_id, doc.section_key),
            status: doc.status,
            reviewNote: doc.review_note,
            reviewStep: doc.review_step,
            todoType: 'write',
          })
        }

        // 2. 审核任务：待审核且当前用户是当前步骤的审核人
        if (doc.status === 'pending_review' && (userRole === 'admin' || userRole === 'member')) {
          const currentReviewer = getReviewerAtStep(doc.feature_project_id, doc.review_step)
          if (currentReviewer === userId) {
            // 避免重复（如果用户既是指派人又是审核人）
            if (!assignees.includes(userId)) {
              todos.push({
                docId: doc.id,
                featureId: doc.feature_id,
                featureTitle: doc.feature_title,
                sectionKey: doc.section_key,
                sectionTitle: getSectionTitle(doc.feature_id, doc.section_key),
                status: doc.status,
                reviewNote: doc.review_note,
                reviewStep: doc.review_step,
                todoType: 'review',
              })
            }
          }
        }
      } catch {
        /* ignore malformed JSON */
      }
    }

    return success(todos)
  })
}
