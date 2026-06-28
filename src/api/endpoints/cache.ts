// ============================================================
// 缓存管理 API：统计、列表、删除
// ============================================================

import { api } from '../client'

export interface CacheStats {
  count: number
  totalSize: number
}

export interface CacheInfo {
  remote: CacheStats
  export: CacheStats
}

export interface CacheCleanResult {
  remoteCleaned: number
  exportCleaned: number
}

/** 导出缓存条目 */
export interface ExportCacheEntry {
  id: string
  catalogId: string
  catalogTitle: string
  type: 'markdown' | 'pdf'
  fingerprint: string
  optionsHash: string
  fileName: string
  fileSize: number
  filePath: string
  createdAt: string
}

/** 远程缓存条目 */
export interface RemoteCacheEntry {
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

/** 导出缓存分页结果 */
export interface ExportCachePage {
  entries: ExportCacheEntry[]
  total: number
}

/** 远程缓存分页结果 */
export interface RemoteCachePage {
  entries: RemoteCacheEntry[]
  total: number
  offset: number
  limit: number
}

const CACHE = '/api/v1/cache'

// ---- 概览 ----

/** 获取缓存统计 */
export function getStats(): Promise<CacheInfo> {
  return api.get<CacheInfo>(`${CACHE}/stats`)
}

/** 清理所有过期缓存 */
export function cleanExpired(): Promise<CacheCleanResult> {
  return api.post<CacheCleanResult>(`${CACHE}/clean`)
}

/** 清除特定 catalog 的导出缓存 */
export function invalidateCatalog(catalogId: string): Promise<void> {
  return api.post<void>(`${CACHE}/invalidate`, { catalogId })
}

// ---- 导出缓存列表 & 删除 ----

/** 列出导出缓存文件（分页） */
export function listExportEntries(limit = 40, offset = 0): Promise<ExportCachePage> {
  return api.get<ExportCachePage>(
    `${CACHE}/entries/export?limit=${limit}&offset=${offset}`,
  )
}

/** 删除单个导出缓存文件 */
export function deleteExportEntry(id: string): Promise<void> {
  return api.delete<void>(`${CACHE}/entries/export/${id}`)
}

/** 下载导出缓存文件 */
export function downloadExportEntry(id: string, filename?: string): Promise<void> {
  return api.download(`${CACHE}/entries/export/${id}/download`, filename)
}

// ---- 远程缓存列表 & 清除 ----

/** 列出远程缓存条目（分页） */
export function listRemoteEntries(offset = 0, limit = 40): Promise<RemoteCachePage> {
  return api.get<RemoteCachePage>(`${CACHE}/entries/remote?offset=${offset}&limit=${limit}`)
}

/** 删除单个远程缓存条目 */
export function deleteRemoteEntry(hash: string, ext: string): Promise<void> {
  const safeExt = ext.startsWith('.') ? ext.slice(1) : ext
  return api.delete<void>(`${CACHE}/entries/remote/${hash}/${safeExt}`)
}

/** 清除全部远程缓存 */
export function clearAllRemote(): Promise<{ deleted: number }> {
  return api.delete<{ deleted: number }>(`${CACHE}/entries/remote/all`)
}

/** 获取远程缓存文件的预览 URL */
export function getRemotePreviewUrl(hash: string, ext: string): string {
  const safeExt = ext.startsWith('.') ? ext.slice(1) : ext
  return `${CACHE}/entries/remote/${hash}/${safeExt}/preview`
}
