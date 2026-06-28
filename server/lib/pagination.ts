// ============================================================
// 分页工具：统一的 LIMIT/OFFSET + COUNT 查询封装
// ============================================================

import type { Database } from 'better-sqlite3'

export interface PaginationParams {
  limit: number
  offset: number
}

export interface PageResult<T> {
  rows: T[]
  total: number
}

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 200

/** 从 query string 中解析 limit 和 offset，应用默认值和上限 */
export function parsePagination(
  query: Record<string, string | undefined>,
  defaults?: { limit?: number; maxLimit?: number },
): PaginationParams {
  const defLimit = defaults?.limit ?? DEFAULT_LIMIT
  const maxLimit = defaults?.maxLimit ?? MAX_LIMIT
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(query.limit || String(defLimit), 10) || defLimit),
  )
  const offset = Math.max(0, parseInt(query.offset || '0', 10) || 0)
  return { limit, offset }
}

/**
 * 执行分页查询
 *
 * @param db       better-sqlite3 Database 实例
 * @param selectSql  SELECT 语句（不含 LIMIT/OFFSET）
 * @param countSql   SELECT COUNT(*) 语句
 * @param params     selectSql 和 countSql 共用参数
 * @param pagination limit 和 offset
 */
export function paginatedQuery<T>(
  db: Database,
  selectSql: string,
  countSql: string,
  params: unknown[],
  pagination: PaginationParams,
): PageResult<T> {
  const countRow = db.prepare(countSql).get(...params) as { cnt: number } | undefined
  const total = countRow?.cnt ?? 0
  const rows = db
    .prepare(`${selectSql} LIMIT ? OFFSET ?`)
    .all(...params, pagination.limit, pagination.offset) as T[]
  return { rows, total }
}
