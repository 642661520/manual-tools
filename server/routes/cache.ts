/**
 * 缓存管理 API
 *
 * GET    /api/v1/cache/stats              — 缓存统计
 * POST   /api/v1/cache/clean              — 手动清理过期缓存
 * POST   /api/v1/cache/invalidate         — 清除特定 catalog 的导出缓存
 * GET    /api/v1/cache/entries/export     — 列出导出缓存文件详情
 * GET    /api/v1/cache/entries/remote     — 列出远程资源缓存详情（分页）
 * GET    /api/v1/cache/entries/remote/:hash/:ext/preview — 预览远程缓存文件
 * DELETE /api/v1/cache/entries/export/:id — 删除单个导出缓存文件
 * DELETE /api/v1/cache/entries/remote/:hash/:ext — 删除单个远程缓存条目
 * DELETE /api/v1/cache/entries/remote/all — 清除全部远程缓存
 */
import { FastifyInstance } from 'fastify'
import { join } from 'path'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { success, ok, fail } from '../lib/response.js'
import { getRemoteCacheStats, cleanExpiredRemoteCache } from '../services/remote-cache.js'
import { getExportCacheStats, cleanExpiredExportCache } from '../services/export-cache.js'
import { getDb } from '../db/index.js'
import { config } from '../config.js'

// 导出缓存条目（含 catalog 名称）
interface ExportCacheEntry {
  id: string
  catalogId: string
  catalogTitle: string
  type: string
  fingerprint: string
  optionsHash: string
  fileName: string
  fileSize: number
  filePath: string
  createdAt: string
}

// 远程缓存条目
interface RemoteCacheEntry {
  url: string
  hash: string
  ext: string
  mimeType: string
  size: number
  etag: string | null
  lastModified: string | null
  createdAt: string
  accessedAt: string
  fetchCount: number
}

export async function cacheRoutes(app: FastifyInstance) {
  // 缓存统计
  app.get('/api/v1/cache/stats', { preHandler: [authMiddleware, requireRole('admin', 'pm')] }, async () => {
    const remote = getRemoteCacheStats()
    const exportStats = getExportCacheStats()
    return success({ remote, export: exportStats })
  })

  // 手动清理过期缓存
  app.post('/api/v1/cache/clean', { preHandler: [authMiddleware, requireRole('admin', 'pm')] }, async () => {
    const remoteCount = cleanExpiredRemoteCache()
    const exportCount = cleanExpiredExportCache()
    return success({ remoteCleaned: remoteCount, exportCleaned: exportCount })
  })

  // 清除特定 catalog 的导出缓存
  app.post('/api/v1/cache/invalidate', { preHandler: [authMiddleware, requireRole('admin', 'pm')] }, async (req, reply) => {
    const body = req.body as { catalogId?: string }
    if (!body.catalogId) {
      return fail(reply, 400, '缺少 catalogId 参数')
    }
    const db = getDb()
    const entries = db.prepare(
      'SELECT id, file_path FROM export_cache WHERE catalog_id = ?',
    ).all(body.catalogId) as { id: string; file_path: string }[]

    for (const entry of entries) {
      try { unlinkSync(entry.file_path) } catch { /* ok */ }
    }
    db.prepare('DELETE FROM export_cache WHERE catalog_id = ?').run(body.catalogId)
    return ok()
  })

  // ================ 列表查询 =========================================

  // 列出导出缓存文件详情（含 catalog 名称，按创建时间倒序）
  app.get('/api/v1/cache/entries/export', { preHandler: [authMiddleware, requireRole('admin', 'pm')] }, async () => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT ec.id, ec.catalog_id, ec.type,
             ec.fingerprint, ec.options_hash,
             ec.file_name, ec.file_size, ec.file_path,
             ec.created_at,
             COALESCE(c.title, '(已删除)') as catalog_title
      FROM export_cache ec
      LEFT JOIN catalogs c ON ec.catalog_id = c.id
      ORDER BY ec.created_at DESC
    `).all() as Array<{
      id: string; catalog_id: string; type: string
      fingerprint: string; options_hash: string
      file_name: string; file_size: number; file_path: string
      created_at: string; catalog_title: string
    }>

    const entries: ExportCacheEntry[] = rows.map(r => ({
      id: r.id,
      catalogId: r.catalog_id,
      catalogTitle: r.catalog_title,
      type: r.type,
      fingerprint: r.fingerprint,
      optionsHash: r.options_hash,
      fileName: r.file_name,
      fileSize: r.file_size,
      filePath: r.file_path,
      createdAt: r.created_at,
    }))

    return success(entries)
  })

  // 列出远程缓存详情（分页）
  app.get('/api/v1/cache/entries/remote', { preHandler: [authMiddleware, requireRole('admin', 'pm')] }, async (req) => {
    const query = req.query as { offset?: string; limit?: string }
    const offset = Math.max(0, parseInt(query.offset || '0'))
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '40')))

    const db = getDb()
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM remote_cache').get() as { cnt: number }).cnt
    const rows = db.prepare(`
      SELECT url, hash, ext, mime_type, size, etag, last_modified,
             created_at, accessed_at, fetch_count
      FROM remote_cache
      ORDER BY accessed_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Array<{
      url: string; hash: string; ext: string; mime_type: string
      size: number; etag: string | null; last_modified: string | null
      created_at: string; accessed_at: string; fetch_count: number
    }>

    const entries: RemoteCacheEntry[] = rows.map(r => ({
      url: r.url,
      hash: r.hash,
      ext: r.ext,
      mimeType: r.mime_type,
      size: r.size,
      etag: r.etag,
      lastModified: r.last_modified,
      createdAt: r.created_at,
      accessedAt: r.accessed_at,
      fetchCount: r.fetch_count,
    }))

    return success({ entries, total, offset, limit })
  })

  // ================ 文件预览 =========================================

  // 预览远程缓存文件（图片/视频等）
  app.get('/api/v1/cache/entries/remote/:hash/:ext/preview', { preHandler: [authMiddleware, requireRole('admin', 'pm')] }, async (req, reply) => {
    const { hash, ext } = req.params as { hash: string; ext: string }

    if (!/^[0-9a-f]{64}$/.test(hash) || !/^[a-z0-9]{1,10}$/i.test(ext)) {
      return fail(reply, 400, '参数格式无效')
    }

    const db = getDb()
    const row = db.prepare(
      'SELECT ext, mime_type FROM remote_cache WHERE hash = ? LIMIT 1',
    ).get(hash) as { ext: string; mime_type: string } | undefined

    if (!row) {
      return fail(reply, 404, '缓存记录不存在')
    }

    const filepath = join(config.cacheDir, 'remote', hash.slice(0, 2), `${hash}.${row.ext}`)

    if (!existsSync(filepath)) {
      return fail(reply, 404, '缓存文件不存在')
    }

    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.pdf': 'application/pdf',
    }
    const mimeType = mimeMap[row.ext] || row.mime_type || 'application/octet-stream'

    const buf = readFileSync(filepath)
    reply.header('Content-Type', mimeType)
    reply.header('Cache-Control', 'private, max-age=3600')
    return reply.send(buf)
  })

  // ================ 逐项删除 =========================================

  // 删除单个导出缓存文件
  app.delete('/api/v1/cache/entries/export/:id', { preHandler: [authMiddleware, requireRole('admin', 'pm')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const entry = db.prepare('SELECT file_path FROM export_cache WHERE id = ?').get(id) as
      { file_path: string } | undefined
    if (!entry) {
      return fail(reply, 404, '缓存条目不存在')
    }

    try { unlinkSync(entry.file_path) } catch { /* 文件可能已被手动删除 */ }
    db.prepare('DELETE FROM export_cache WHERE id = ?').run(id)

    return ok()
  })

  // 清除全部远程缓存
  app.delete('/api/v1/cache/entries/remote/all', { preHandler: [authMiddleware, requireRole('admin', 'pm')] }, async () => {
    const db = getDb()
    const rows = db.prepare('SELECT hash, ext FROM remote_cache').all() as
      { hash: string; ext: string }[]

    // 删除磁盘文件（去重 hash）
    const remoteDir = join(config.cacheDir, 'remote')
    const seen = new Set<string>()
    for (const row of rows) {
      if (!seen.has(row.hash)) {
        seen.add(row.hash)
        const filepath = join(remoteDir, row.hash.slice(0, 2), `${row.hash}.${row.ext}`)
        try { unlinkSync(filepath) } catch { /* ok */ }
      }
    }

    const result = db.prepare('DELETE FROM remote_cache').run()
    return success({ deleted: result.changes })
  })

  // 删除单个远程缓存条目
  app.delete('/api/v1/cache/entries/remote/:hash/:ext', { preHandler: [authMiddleware, requireRole('admin', 'pm')] }, async (req, reply) => {
    const { hash, ext } = req.params as { hash: string; ext: string }

    if (!/^[0-9a-f]{64}$/.test(hash) || !/^[a-z0-9]{1,10}$/i.test(ext)) {
      return fail(reply, 400, '参数格式无效')
    }

    const db = getDb()

    // 先查要删除的记录的 ext（用于构建磁盘路径）
    const target = db.prepare('SELECT ext FROM remote_cache WHERE hash = ? LIMIT 1').get(hash) as
      { ext: string } | undefined
    if (!target) {
      return fail(reply, 404, '缓存条目不存在')
    }

    // 统计同一 hash 被多少条记录引用
    const refCount = (db.prepare('SELECT COUNT(*) as cnt FROM remote_cache WHERE hash = ?').get(hash) as { cnt: number }).cnt

    // 删除数据库记录
    db.prepare('DELETE FROM remote_cache WHERE hash = ?').run(hash)

    // 如果这是最后一条引用该 hash 的记录，删除磁盘文件
    if (refCount <= 1) {
      const filepath = join(config.cacheDir, 'remote', hash.slice(0, 2), `${hash}.${target.ext}`)
      try { unlinkSync(filepath) } catch { /* ok */ }
    }

    return ok()
  })
}