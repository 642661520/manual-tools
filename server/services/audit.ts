/** 操作审计服务：记录敏感操作，供安全追溯 */
import { v4 as uuid } from 'uuid'
import { getDb } from '../db/index.js'

export interface AuditEntry {
  userId: string
  username: string
  action: string
  targetType: string
  targetId?: string
  detail?: unknown
}

/** 记录一条审计日志 */
export function recordAudit(entry: AuditEntry) {
  const db = getDb()
  db.prepare(
    'INSERT INTO audit_log (id, user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    uuid(),
    entry.userId,
    entry.username,
    entry.action,
    entry.targetType,
    entry.targetId || '',
    entry.detail ? JSON.stringify(entry.detail) : '',
  )
}

export interface AuditLogQuery {
  userId?: string
  action?: string
  targetType?: string
  limit?: number
  offset?: number
}

export interface AuditLogRow {
  id: string
  user_id: string
  username: string
  action: string
  target_type: string
  target_id: string
  detail: string
  created_at: string
}

/** 查询审计日志（支持分页和筛选） */
export function queryAuditLogs(q: AuditLogQuery): { rows: AuditLogRow[]; total: number } {
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (q.userId) {
    conditions.push('user_id = ?')
    params.push(q.userId)
  }
  if (q.action) {
    conditions.push('action = ?')
    params.push(q.action)
  }
  if (q.targetType) {
    conditions.push('target_type = ?')
    params.push(q.targetType)
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(q.limit || 50, 200)
  const offset = q.offset || 0

  const rows = db
    .prepare(`SELECT * FROM audit_log${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as AuditLogRow[]

  for (const row of rows) {
    if (row.created_at && !row.created_at.endsWith('Z')) {
      row.created_at += 'Z'
    }
  }

  const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM audit_log${where}`).get(...params) as {
    cnt: number
  }

  return { rows, total: totalRow.cnt }
}
