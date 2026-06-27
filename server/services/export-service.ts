// ============================================================
// 导出服务：收集项目数据 → 流式生成 ZIP → 写入磁盘
// ============================================================

import { getDb } from '../db/index.js'
import fs from 'fs'
import path from 'path'
import { ZipArchive } from 'archiver'
import { config } from '../config.js'
import type { ExportEstimate } from '../../shared/types/models.js'
import type {
  ProjectRow,
  FeatureRow,
  DocumentRow,
  CatalogRow,
  CategoryRow,
  CatalogVersionRow,
} from '../types.js'

const UPLOAD_BASE = config.uploadDir
const EXPORT_BASE = config.exportDir

/** 从 Y.js BLOB 中提取 /uploads/ 文件引用路径 */
export function extractUploadRefsFromBlob(blob: Buffer): string[] {
  const text = blob.toString('utf-8')
  const re = /\/uploads\/(images|videos)\/[a-f0-9]{2}\/[a-f0-9]{64}\.[a-zA-Z]+/g
  return [...new Set([...text.matchAll(re)].map((m) => m[0].replace(/^\/uploads\//, '')))]
}

/** 收集项目下所有文档 BLOB 中引用的上传文件路径 */
function collectUploadRefs(projectId: string): string[] {
  const db = getDb()

  // 从最新快照中提取引用
  const snapshots = db
    .prepare(`
    SELECT ds.snapshot_data FROM document_snapshots ds
    JOIN documents d ON d.id = ds.document_id
    JOIN features f ON f.id = d.feature_id
    WHERE f.project_id = ?
    ORDER BY ds.id DESC
  `)
    .all(projectId) as { snapshot_data: Buffer }[]

  const refs = new Set<string>()
  for (const s of snapshots) {
    for (const ref of extractUploadRefsFromBlob(s.snapshot_data)) {
      refs.add(ref)
    }
  }

  // 也从 pending updates 中提取
  const updates = db
    .prepare(`
    SELECT du.update_data FROM document_updates du
    JOIN documents d ON d.id = du.document_id
    JOIN features f ON f.id = d.feature_id
    WHERE f.project_id = ?
  `)
    .all(projectId) as { update_data: Buffer }[]

  for (const u of updates) {
    for (const ref of extractUploadRefsFromBlob(u.update_data)) {
      refs.add(ref)
    }
  }

  return [...refs]
}

/** 计算导出的预估大小 */
export function estimateExport(projectId: string): ExportEstimate {
  const db = getDb()

  // 结构计数
  const featureCount = (
    db.prepare('SELECT COUNT(*) as cnt FROM features WHERE project_id = ?').get(projectId) as {
      cnt: number
    }
  ).cnt

  const catalogCount = (
    db.prepare('SELECT COUNT(*) as cnt FROM catalogs WHERE project_id = ?').get(projectId) as {
      cnt: number
    }
  ).cnt

  const docCount = (
    db
      .prepare(`
    SELECT COUNT(*) as cnt FROM documents d
    JOIN features f ON f.id = d.feature_id
    WHERE f.project_id = ?
  `)
      .get(projectId) as { cnt: number }
  ).cnt

  // 结构化数据大小：updates + snapshots BLOB
  const updatesSize = (
    db
      .prepare(`
    SELECT COALESCE(SUM(LENGTH(du.update_data)), 0) as total FROM document_updates du
    JOIN documents d ON d.id = du.document_id
    JOIN features f ON f.id = d.feature_id
    WHERE f.project_id = ?
  `)
      .get(projectId) as { total: number }
  ).total

  const snapshotsSize = (
    db
      .prepare(`
    SELECT COALESCE(SUM(LENGTH(ds.snapshot_data)), 0) as total FROM document_snapshots ds
    JOIN documents d ON d.id = ds.document_id
    JOIN features f ON f.id = d.feature_id
    WHERE f.project_id = ?
  `)
      .get(projectId) as { total: number }
  ).total

  const structuredSize = updatesSize + snapshotsSize

  // 上传文件大小
  const refs = collectUploadRefs(projectId)
  let uploadsSize = 0
  for (const ref of refs) {
    const filePath = path.join(UPLOAD_BASE, ref)
    try {
      uploadsSize += fs.statSync(filePath).size
    } catch {
      /* 文件可能不存在 */
    }
  }

  return {
    features: featureCount,
    catalogs: catalogCount,
    documents: docCount,
    uploads: refs.length,
    structuredSize,
    uploadsSize,
    totalSize: structuredSize + uploadsSize,
  }
}

/** 异步执行导出任务 */
export async function runExportTask(
  taskId: string,
  projectId: string,
  updateProgress: (progress: number, label: string) => void,
): Promise<{ filePath: string; fileSize: number; summary: ExportEstimate }> {
  const db = getDb()

  // 阶段1：收集数据（0-10%）
  updateProgress(0, '正在收集项目数据...')

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | ProjectRow
    | undefined
  if (!project) throw new Error('项目不存在')

  const categories = db
    .prepare('SELECT * FROM categories WHERE project_id = ? ORDER BY sort_order')
    .all(projectId) as CategoryRow[]

  const features = db
    .prepare('SELECT * FROM features WHERE project_id = ? ORDER BY title')
    .all(projectId) as FeatureRow[]

  const catalogs = db
    .prepare('SELECT * FROM catalogs WHERE project_id = ?')
    .all(projectId) as CatalogRow[]

  // 文档数据
  const docIds = (
    db
      .prepare(`
    SELECT d.id FROM documents d
    JOIN features f ON f.id = d.feature_id
    WHERE f.project_id = ?
  `)
      .all(projectId) as { id: string }[]
  ).map((r) => r.id)

  updateProgress(3, '正在收集文档数据...')

  const documents: Record<
    string,
    {
      row: DocumentRow
      snapshot: string | null
      updates: string[]
    }
  > = {}

  for (const docId of docIds) {
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as
      | DocumentRow
      | undefined
    if (!row) continue

    const snapshot = db
      .prepare(
        'SELECT snapshot_data FROM document_snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(docId) as { snapshot_data: Buffer } | undefined

    const updates = db
      .prepare('SELECT update_data FROM document_updates WHERE document_id = ? ORDER BY id ASC')
      .all(docId) as { update_data: Buffer }[]

    documents[docId] = {
      row,
      snapshot: snapshot ? snapshot.snapshot_data.toString('base64') : null,
      updates: updates.map((u) => u.update_data.toString('base64')),
    }
  }

  // catalog versions
  const catalogVersions: Record<string, CatalogVersionRow[]> = {}
  for (const cat of catalogs) {
    catalogVersions[cat.id] = db
      .prepare(
        'SELECT * FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major, version_minor',
      )
      .all(cat.id) as CatalogVersionRow[]
  }

  // 项目成员
  const members = db
    .prepare(`
    SELECT pm.user_id FROM project_members pm WHERE pm.project_id = ?
  `)
    .all(projectId) as { user_id: string }[]

  updateProgress(8, '正在扫描上传文件引用...')

  // 收集上传文件引用
  const uploadRefs = collectUploadRefs(projectId)

  const summary: ExportEstimate = {
    features: features.length,
    catalogs: catalogs.length,
    documents: docIds.length,
    uploads: uploadRefs.length,
    structuredSize: 0, // 稍后计算
    uploadsSize: 0,
    totalSize: 0,
  }

  updateProgress(10, '正在生成导出文件...')

  // 阶段2：流式生成 ZIP（10-95%）
  const exportDir = EXPORT_BASE
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true })
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safeName = project.name.replace(/[<>:"/\\|?*]/g, '_')
  const fileName = `${safeName}-export-${timestamp}.zip`
  const filePath = path.join(exportDir, fileName)

  const output = fs.createWriteStream(filePath)
  const archive = new ZipArchive({ zlib: { level: 9 } })

  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve)
    archive.on('error', reject)

    archive.pipe(output)

    // 写入 manifest.json
    archive.append(
      JSON.stringify(
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          source: { projectId, projectName: project.name },
        },
        null,
        2,
      ),
      { name: 'manifest.json' },
    )

    // 写入 data.json
    const dataJson = JSON.stringify({
      data: {
        project,
        categories,
        features,
        documents,
        catalogs: catalogs.map((c) => ({
          row: c,
          versions: catalogVersions[c.id] || [],
        })),
        projectMembers: members.map((m) => m.user_id),
      },
      uploadsManifest: uploadRefs.map((ref) => {
        const fp = path.join(UPLOAD_BASE, ref)
        let size = 0
        try {
          size = fs.statSync(fp).size
        } catch {
          /* ignore */
        }
        return { path: ref, size }
      }),
    })
    archive.append(dataJson, { name: 'data.json' })

    summary.structuredSize = Buffer.byteLength(dataJson, 'utf-8')

    // 追加上传文件
    const totalFiles = uploadRefs.length
    let completedFiles = 0
    let totalUploadSize = 0

    for (const ref of uploadRefs) {
      const fp = path.join(UPLOAD_BASE, ref)
      if (fs.existsSync(fp)) {
        archive.file(fp, { name: `uploads/${ref}` })
        const stat = fs.statSync(fp)
        totalUploadSize += stat.size
      }
      completedFiles++
      const pct = 10 + Math.floor((completedFiles / Math.max(totalFiles, 1)) * 85)
      updateProgress(pct, `正在打包文件 ${completedFiles}/${totalFiles}...`)
    }

    summary.uploadsSize = totalUploadSize
    summary.totalSize = summary.structuredSize + totalUploadSize

    archive.finalize()
  })

  const fileSize = fs.statSync(filePath).size
  updateProgress(100, '导出完成')

  return { filePath, fileSize, summary }
}
