/**
 * 远程资源缓存服务
 *
 * 通用缓存层，支持图片、视频、音频等所有远程媒体类型。
 * SHA-256 内容寻址，跨 catalog 共享，ETag 条件请求。
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { config } from '../config.js'
import { getDb } from '../db/index.js'

// ================ 类型 ========================================================

interface CachedRow {
  url: string
  hash: string
  ext: string
  mime_type: string
  size: number
  etag: string | null
  last_modified: string | null
  created_at: string
  accessed_at: string
}

interface CacheResult {
  /** 本地文件绝对路径 */
  filepath: string
  /** MIME 类型 */
  mimeType: string
  /** 文件大小（字节） */
  size: number
}

// ================ 公开 API ====================================================

/**
 * 缓存优先获取远程资源。
 * 命中缓存 → 返回本地路径；未命中 → 下载并存缓存后返回。
 * 失败返回 null（不抛异常，调用方自行降级）。
 */
export async function getOrFetch(url: string): Promise<CacheResult | null> {
  // 1. 查缓存
  const cached = getCached(url)
  if (cached) return cached

  // 2. 下载
  return fetchAndCache(url)
}

/**
 * 仅查缓存，不触发下载。未命中返回 null。
 */
export function getCached(url: string): CacheResult | null {
  const db = getDb()
  const row = db.prepare(
    'SELECT * FROM remote_cache WHERE url = ? ORDER BY created_at DESC LIMIT 1',
  ).get(url) as CachedRow | undefined
  if (!row) return null

  const filepath = getCachePath(row.hash, row.ext)
  if (!existsSync(filepath)) {
    // 文件丢失，清理脏记录
    db.prepare('DELETE FROM remote_cache WHERE url = ? AND hash = ?').run(url, row.hash)
    return null
  }

  // 更新访问时间
  db.prepare(
    'UPDATE remote_cache SET accessed_at = datetime(\'now\'), fetch_count = fetch_count + 1 WHERE url = ? AND hash = ?',
  ).run(url, row.hash)

  return { filepath, mimeType: row.mime_type, size: row.size }
}

/**
 * 强制重新下载并刷新缓存。
 */
export async function refreshCache(url: string): Promise<CacheResult | null> {
  return fetchAndCache(url, true)
}

/**
 * 清理 TTL 过期的远程资源缓存。
 * 返回清理的记录数。
 */
export function cleanExpiredRemoteCache(): number {
  const db = getDb()
  const ttlDays = config.remoteCacheTtlDays
  const expired = db.prepare(
    `SELECT url, hash, ext FROM remote_cache
     WHERE datetime(accessed_at, '+' || ? || ' days') < datetime('now')`,
  ).all(ttlDays) as { url: string; hash: string; ext: string }[]

  // 收集所有过期 hash → 检查哪些 hash 不再被任何（非过期）记录引用
  const expiredHashes = new Set(expired.map(r => r.hash))
  const remainingHashes = new Set<string>()
  for (const hash of expiredHashes) {
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM remote_cache WHERE hash = ?
       AND datetime(accessed_at, '+' || ? || ' days') >= datetime('now')`,
    ).get(hash, ttlDays) as { cnt: number }
    if (row.cnt > 0) remainingHashes.add(hash)
  }

  // 删除过期记录
  const result = db.prepare(
    `DELETE FROM remote_cache
     WHERE datetime(accessed_at, '+' || ? || ' days') < datetime('now')`,
  ).run(ttlDays)

  // 删除不再被引用的磁盘文件
  for (const row of expired) {
    if (!remainingHashes.has(row.hash)) {
      const filepath = getCachePath(row.hash, row.ext)
      try { unlinkSync(filepath) } catch { /* 文件可能已被手动删除 */ }
    }
  }

  if (result.changes > 0) {
    console.log(`[remote-cache] Cleaned up ${result.changes} expired cache entries.`)
  }
  return result.changes
}

/**
 * 获取缓存统计信息。
 */
export function getRemoteCacheStats(): { count: number; totalSize: number } {
  const db = getDb()
  const row = db.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM remote_cache',
  ).get() as { count: number; totalSize: number }
  return row
}

// ================ 内部实现 ====================================================

/** 获取缓存文件存储路径 */
function getCachePath(hash: string, ext: string): string {
  return join(config.cacheDir, 'remote', hash.slice(0, 2), `${hash}.${ext}`)
}

/** 确保缓存目录存在 */
function ensureCacheDir(hash: string): string {
  const dir = join(config.cacheDir, 'remote', hash.slice(0, 2))
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 从 URL 推断文件扩展名 */
function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url.startsWith('//') ? `https:${url}` : url).pathname
    const ext = pathname.split('.').pop()?.toLowerCase()
    // 常见媒体类型
    const valid = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
      'mp4', 'webm', 'mov', 'avi',
      'mp3', 'wav', 'ogg', 'flac',
      'pdf', 'md', 'txt', 'json',
      'ttf', 'woff', 'woff2', 'otf',
    ]
    return valid.includes(ext || '') ? `.${ext}` : ''
  } catch {
    return ''
  }
}

/** 根据文件扩展名推断 MIME 类型 */
function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.pdf': 'application/pdf',
    '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.otf': 'font/otf',
  }
  return map[ext] || 'application/octet-stream'
}

/**
 * 下载远程资源并存入缓存。
 * @param force 为 true 时跳过条件请求，强制下载
 */
async function fetchAndCache(url: string, force = false): Promise<CacheResult | null> {
  const fullUrl = url.startsWith('//') ? `https:${url}` : url

  try {
    // 检查文件大小限制
    const maxBytes = config.remoteCacheMaxFileMb * 1024 * 1024

    // 获取之前的 ETag / Last-Modified（用于条件请求）
    const db = getDb()
    let prevEtag: string | null = null
    let prevLastModified: string | null = null
    if (!force) {
      const prev = db.prepare(
        'SELECT etag, last_modified FROM remote_cache WHERE url = ? ORDER BY created_at DESC LIMIT 1',
      ).get(url) as { etag: string | null; last_modified: string | null } | undefined
      if (prev) {
        prevEtag = prev.etag
        prevLastModified = prev.last_modified
      }
    }

    const headers: Record<string, string> = {}
    if (!force && prevEtag) headers['If-None-Match'] = prevEtag
    if (!force && prevLastModified) headers['If-Modified-Since'] = prevLastModified

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    try {
      const res = await fetch(fullUrl, { headers, signal: controller.signal })

      if (res.status === 304) {
        // 内容未变化，仅更新访问时间
        db.prepare(
          `UPDATE remote_cache SET accessed_at = datetime('now'), fetch_count = fetch_count + 1
           WHERE url = ? AND etag = ?`,
        ).run(url, prevEtag)
        // 重新查询返回
        return getCached(url)
      }

      if (!res.ok) return null

      // 检查 Content-Length（如果服务器提供了）
      const contentLength = res.headers.get('content-length')
      if (contentLength && parseInt(contentLength) > maxBytes) {
        console.warn(`[remote-cache] URL ${url} 超过大小限制 (${contentLength} > ${maxBytes})，跳过下载`)
        return null
      }

      const buf = Buffer.from(await res.arrayBuffer())

      if (buf.length > maxBytes) {
        console.warn(`[remote-cache] URL ${url} 实际大小超过限制 (${buf.length} > ${maxBytes})，仅下载不缓存`)
        return null
      }

      // 计算 SHA-256 哈希
      const hash = createHash('sha256').update(buf).digest('hex')

      // 推断扩展名和 MIME 类型
      let ext = extFromUrl(fullUrl)
      if (!ext) {
        // 从 Content-Type 推断
        const ct = res.headers.get('content-type') || ''
        ext = extFromContentType(ct)
      }
      const mimeType = res.headers.get('content-type') || mimeFromExt(ext)
      const etag = res.headers.get('etag')
      const lastModified = res.headers.get('last-modified')

      // 检查是否已有相同 hash 的文件（去重）
      const existing = db.prepare(
        'SELECT ext FROM remote_cache WHERE hash = ? LIMIT 1',
      ).get(hash) as { ext: string } | undefined
      if (existing) {
        // 复用已有文件
        ext = existing.ext
      } else {
        // 写入磁盘
        ensureCacheDir(hash)
        const filepath = getCachePath(hash, ext)
        writeFileSync(filepath, buf)
      }

      // 写入数据库（如果该 url+hash 组合不存在则插入，否则更新）
      db.prepare(`
        INSERT INTO remote_cache (url, hash, ext, mime_type, size, etag, last_modified, accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(url, hash) DO UPDATE SET
          etag = excluded.etag,
          last_modified = excluded.last_modified,
          accessed_at = datetime('now'),
          fetch_count = fetch_count + 1
      `).run(url, hash, ext, mimeType, buf.length, etag, lastModified)

      return { filepath: getCachePath(hash, ext), mimeType, size: buf.length }
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return null
  }
}

/** 从 Content-Type 推断文件扩展名 */
function extFromContentType(ct: string): string {
  const map: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
    'application/pdf': '.pdf',
    'text/markdown': '.md', 'text/plain': '.txt',
  }
  // 去掉 charset 等参数
  const baseType = ct.split(';')[0].trim()
  return map[baseType] || ''
}
