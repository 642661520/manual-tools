// ============================================================
// 上传文件清理：扫描未被引用的孤儿文件
// ============================================================

import { getDb } from '../db/index.js'
import fs from 'fs'
import path from 'path'
import { extractUploadRefsFromBlob } from './export-service.js'
import { config } from '../config.js'

const UPLOAD_BASE = config.uploadDir

export interface OrphanFile {
  path: string
  size: number
  mtime: string
}

/** 扫描所有文档 BLOB，收集被引用的上传文件路径 */
function collectAllReferencedUploads(): Set<string> {
  const db = getDb()
  const refs = new Set<string>()

  const snapshots = db.prepare(
    'SELECT snapshot_data FROM document_snapshots ORDER BY id DESC',
  ).all() as { snapshot_data: Buffer }[]

  for (const s of snapshots) {
    for (const ref of extractUploadRefsFromBlob(s.snapshot_data)) {
      refs.add(ref)
    }
  }

  const updates = db.prepare(
    'SELECT update_data FROM document_updates',
  ).all() as { update_data: Buffer }[]

  for (const u of updates) {
    for (const ref of extractUploadRefsFromBlob(u.update_data)) {
      refs.add(ref)
    }
  }

  return refs
}

/** 递归列出 uploads 目录中的所有文件 */
function listAllUploadFiles(dir: string, prefix = ''): string[] {
  const files: string[] = []
  if (!fs.existsSync(dir)) return files

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...listAllUploadFiles(fullPath, relativePath))
    } else {
      files.push(relativePath)
    }
  }
  return files
}

/** 列出所有未被引用的上传文件 */
export function getOrphanFiles(): OrphanFile[] {
  const refs = collectAllReferencedUploads()
  const allFiles = listAllUploadFiles(UPLOAD_BASE)
  const orphans: OrphanFile[] = []

  for (const file of allFiles) {
    if (!refs.has(file)) {
      const fullPath = path.join(UPLOAD_BASE, file)
      try {
        const stat = fs.statSync(fullPath)
        orphans.push({
          path: file,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        })
      } catch { /* 文件可能在扫描期间被删除 */ }
    }
  }

  return orphans
}

/** 删除孤儿文件 */
export function deleteOrphanFiles(): { deleted: number; freedBytes: number } {
  const orphans = getOrphanFiles()
  let deleted = 0
  let freedBytes = 0

  for (const orphan of orphans) {
    const fullPath = path.join(UPLOAD_BASE, orphan.path)
    try {
      fs.unlinkSync(fullPath)
      deleted++
      freedBytes += orphan.size
    } catch { /* 删除失败不中断 */ }
  }

  return { deleted, freedBytes }
}
