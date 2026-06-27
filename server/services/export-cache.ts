/**
 * 导出产物缓存服务
 *
 * 缓存生成的 Markdown ZIP 和 PDF 文件，基于 catalog 内容指纹命中。
 * 当文档内容、catalog 结构或导出参数未变化时，直接返回缓存文件，跳过组装和渲染。
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { isCatalogPart } from '../types.js'
import type { CatalogFeatureEntry, CatalogEntry } from '../types.js'
import { getLogger } from '../lib/logger.js'

const log = getLogger()

// ================ 类型 ========================================================

interface CacheResult {
  filePath: string
  fileName: string
}

interface ExportOptions {
  approvedOnly?: boolean
  statusOverride?: Record<string, string>
  mode?: string
}

// ================ 公开 API ====================================================

/**
 * 计算 catalog 的导出内容指纹。
 * 指纹变化意味着导出产物需要重新构建。
 */
export function computeFingerprint(catalogId: string): string {
  const db = getDb()
  const catalog = db.prepare('SELECT features, targets, cover_info FROM catalogs WHERE id = ?').get(catalogId) as
    { features: string; targets: string; cover_info: string } | undefined
  if (!catalog) return ''

  // 收集 catalog 中所有 feature 的 document 更新信息
  const entries: CatalogEntry[] = JSON.parse(catalog.features)
  const flatFeatures = flattenFeatureEntries(entries)

  // 获取所有相关 document 的最大 updated_at 和更新时间
  let maxDocUpdatedAt = ''
  const docIds: string[] = []
  for (const fe of flatFeatures) {
    const f = db.prepare('SELECT sections FROM features WHERE id = ?').get(fe.featureId) as
      { sections: string } | undefined
    if (!f) continue
    const sections = JSON.parse(f.sections || '[]') as { key: string }[]
    for (const s of sections) {
      docIds.push(`${fe.featureId}/${s.key}`)
    }
  }

  if (docIds.length > 0) {
    const placeholders = docIds.map(() => '?').join(',')
    const row = db.prepare(
      `SELECT MAX(updated_at) as max_updated FROM documents WHERE id IN (${placeholders})`,
    ).get(...docIds) as { max_updated: string | null }
    maxDocUpdatedAt = row?.max_updated || ''
  }

  const content = [
    catalog.features,
    catalog.targets,
    catalog.cover_info,
    maxDocUpdatedAt,
  ].join('|')

  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * 计算导出参数哈希。
 */
export function computeOptionsHash(opts: ExportOptions): string {
  const normalized = {
    approvedOnly: opts.approvedOnly ?? false,
    statusOverride: opts.statusOverride ?? {},
    mode: opts.mode ?? '',
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 8)
}

/**
 * 尝试获取缓存的导出文件。
 * 命中返回文件路径和下载文件名，未命中返回 null。
 */
export function getCachedExport(
  catalogId: string,
  type: 'markdown' | 'pdf',
  fingerprint: string,
  optionsHash: string,
): CacheResult | null {
  const db = getDb()
  const row = db.prepare(
    `SELECT file_path, file_name FROM export_cache
     WHERE catalog_id = ? AND type = ? AND fingerprint = ? AND options_hash = ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(catalogId, type, fingerprint, optionsHash) as
    { file_path: string; file_name: string } | undefined
  if (!row) return null

  if (!existsSync(row.file_path)) {
    // 文件丢失，清理脏记录
    db.prepare(
      'DELETE FROM export_cache WHERE catalog_id = ? AND type = ? AND fingerprint = ? AND options_hash = ?',
    ).run(catalogId, type, fingerprint, optionsHash)
    return null
  }

  return { filePath: row.file_path, fileName: row.file_name }
}

/**
 * 保存导出产物到缓存。
 * 自动清理同一 catalog+type 的旧缓存（保留最新的 N 个）。
 */
export function saveCachedExport(
  catalogId: string,
  type: 'markdown' | 'pdf',
  fingerprint: string,
  optionsHash: string,
  buffer: Buffer,
  fileName: string,
): void {
  const exportDir = join(config.cacheDir, 'exports', catalogId)
  if (!existsSync(exportDir)) {
    mkdirSync(exportDir, { recursive: true })
  }

  const id = `${type}-${fingerprint}-${optionsHash}`
  const filePath = join(exportDir, `${id}${getExt(type)}`)

  writeFileSync(filePath, buffer)

  const db = getDb()
  // 先清理同一 catalog+type+fingerprint+optionsHash 的旧记录（覆盖写入场景）
  db.prepare(
    'DELETE FROM export_cache WHERE catalog_id = ? AND type = ? AND fingerprint = ? AND options_hash = ?',
  ).run(catalogId, type, fingerprint, optionsHash)

  db.prepare(
    `INSERT INTO export_cache (id, catalog_id, type, fingerprint, options_hash, file_path, file_name, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, catalogId, type, fingerprint, optionsHash, filePath, fileName, buffer.length)

  // 保留每个 catalog+type 最新 5 个缓存，删除更旧的
  const oldEntries = db.prepare(
    `SELECT id, file_path FROM export_cache
     WHERE catalog_id = ? AND type = ? AND id != ?
     ORDER BY created_at DESC`,
  ).all(catalogId, type, id) as { id: string; file_path: string }[]

  // 跳过最新 4 个（保留当前 + 4 个旧的 = 5 个）
  for (let i = 4; i < oldEntries.length; i++) {
    try { unlinkSync(oldEntries[i].file_path) } catch { /* ok */ }
    db.prepare('DELETE FROM export_cache WHERE id = ?').run(oldEntries[i].id)
  }
}

/**
 * 清理过期的导出产物缓存。
 * 同时清理已删除 catalog 的孤儿缓存文件。
 */
export function cleanExpiredExportCache(): number {
  const db = getDb()
  const ttlDays = config.exportCacheTtlDays

  // 清理过期记录
  const expired = db.prepare(
    `SELECT id, file_path FROM export_cache
     WHERE datetime(created_at, '+' || ? || ' days') < datetime('now')`,
  ).all(ttlDays) as { id: string; file_path: string }[]

  for (const row of expired) {
    try { unlinkSync(row.file_path) } catch { /* ok */ }
    db.prepare('DELETE FROM export_cache WHERE id = ?').run(row.id)
  }

  // 清理孤儿记录（catalog 已被删除，但 ON DELETE CASCADE 已处理 DB 记录，这里清理磁盘文件）
  // 遍历 data/cache/exports/ 下的目录，删除对应 catalog 已不存在的
  const exportsDir = join(config.cacheDir, 'exports')
  if (existsSync(exportsDir)) {
    let catalogDirs: string[]
    try {
      catalogDirs = readdirSync(exportsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
    } catch {
      catalogDirs = []
    }
    for (const dir of catalogDirs) {
      const catalog = db.prepare('SELECT id FROM catalogs WHERE id = ?').get(dir)
      if (!catalog) {
        // catalog 已删除 → 清理整个目录
        try { rmSync(join(exportsDir, dir), { recursive: true, force: true }) } catch { /* ok */ }
      }
    }
  }

  if (expired.length > 0) {
    log.info({ count: expired.length }, 'export cache cleaned')
  }
  return expired.length
}

/**
 * 获取导出产物缓存统计。
 */
export function getExportCacheStats(): { count: number; totalSize: number } {
  const db = getDb()
  const row = db.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as totalSize FROM export_cache',
  ).get() as { count: number; totalSize: number }
  return row
}

// ================ 内部实现 ====================================================

function getExt(type: 'markdown' | 'pdf'): string {
  return type === 'markdown' ? '.zip' : '.pdf'
}

/** 展平 CatalogEntry 列表（展开 Part），收集所有 featureId */
function flattenFeatureEntries(entries: CatalogEntry[]): CatalogFeatureEntry[] {
  const result: CatalogFeatureEntry[] = []
  for (const entry of entries) {
    if (isCatalogPart(entry)) {
      result.push(...entry.features)
    } else {
      result.push(entry)
    }
  }
  return result
}
