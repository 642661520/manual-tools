// ============================================================
// 导出服务：收集项目数据 → 流式生成 ZIP → 写入磁盘
// v2 格式：按实体类型拆分文件，文档为 HTML，图片用相对路径
// ============================================================

import { getDb } from '../db/index.js'
import fs from 'fs'
import path from 'path'
import { ZipArchive } from 'archiver'
import { config } from '../config.js'
import { yjsDataToHtml } from '../lib/yjs-utils.js'
import { extractUploadRefsFromHtml, absoluteToRelativeUploadPaths } from '../lib/upload-refs.js'
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

/** 收集项目下所有文档 HTML 中引用的上传文件路径 */
function collectUploadRefs(projectId: string): string[] {
  const db = getDb()
  const refs = new Set<string>()

  const docIds = (
    db
      .prepare(`
    SELECT d.id FROM documents d
    JOIN features f ON f.id = d.feature_id
    WHERE f.project_id = ?
  `)
      .all(projectId) as { id: string }[]
  ).map((r) => r.id)

  for (const docId of docIds) {
    const snapshot = db
      .prepare(
        'SELECT snapshot_data FROM document_snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(docId) as { snapshot_data: Buffer } | undefined

    const updates = db
      .prepare('SELECT update_data FROM document_updates WHERE document_id = ? ORDER BY id ASC')
      .all(docId) as { update_data: Buffer }[]

    const html = yjsDataToHtml(
      snapshot?.snapshot_data ?? null,
      updates.map((u) => u.update_data),
    )
    for (const ref of extractUploadRefsFromHtml(html)) {
      refs.add(ref)
    }
  }

  return [...refs]
}

/** 计算导出的预估大小 */
export function estimateExport(projectId: string): ExportEstimate {
  const db = getDb()

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

  // BLOB 大小近似（不解码，性能优先）
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
    .prepare(
      'SELECT id, title, features, cover_info, project_id, created_at, updated_at FROM catalogs WHERE project_id = ?',
    )
    .all(projectId) as CatalogRow[]

  // catalog versions
  const catalogVersions: Record<string, CatalogVersionRow[]> = {}
  for (const cat of catalogs) {
    catalogVersions[cat.id] = db
      .prepare(
        'SELECT * FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major, version_minor',
      )
      .all(cat.id) as CatalogVersionRow[]
  }

  // 文档数据 — 收集 docId + 元数据，稍后在 ZIP 写入阶段解码 HTML
  const docIds = (
    db
      .prepare(`
    SELECT d.id FROM documents d
    JOIN features f ON f.id = d.feature_id
    WHERE f.project_id = ?
  `)
      .all(projectId) as { id: string }[]
  ).map((r) => r.id)

  updateProgress(5, '正在处理文档内容...')

  // 预加载所有文档的 Y.js 数据，稍后在 ZIP 流式写入时解码
  const docSnapshots = new Map<string, Buffer | null>()
  const docUpdates = new Map<string, Buffer[]>()
  const docRows = new Map<string, DocumentRow>()

  for (const docId of docIds) {
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as
      | DocumentRow
      | undefined
    if (!row) continue
    docRows.set(docId, row)

    const snapshot = db
      .prepare(
        'SELECT snapshot_data FROM document_snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(docId) as { snapshot_data: Buffer } | undefined
    docSnapshots.set(docId, snapshot?.snapshot_data ?? null)

    const updates = db
      .prepare('SELECT update_data FROM document_updates WHERE document_id = ? ORDER BY id ASC')
      .all(docId) as { update_data: Buffer }[]
    docUpdates.set(
      docId,
      updates.map((u) => u.update_data),
    )
  }

  updateProgress(8, '正在扫描上传文件引用...')

  const uploadRefs = collectUploadRefs(projectId)

  const summary: ExportEstimate = {
    features: features.length,
    catalogs: catalogs.length,
    documents: docIds.length,
    uploads: uploadRefs.length,
    structuredSize: 0,
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

  let structuredSize = 0

  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve)
    archive.on('error', reject)

    archive.pipe(output)

    // ---- manifest.json ----
    const manifestJson = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        source: { projectId, projectName: project.name },
      },
      null,
      2,
    )
    archive.append(manifestJson, { name: 'manifest.json' })
    structuredSize += Buffer.byteLength(manifestJson, 'utf-8')

    // ---- project.json ----
    const projectJson = JSON.stringify(
      {
        id: project.id,
        name: project.name,
        description: project.description,
      },
      null,
      2,
    )
    archive.append(projectJson, { name: 'project.json' })
    structuredSize += Buffer.byteLength(projectJson, 'utf-8')

    // ---- categories.json ----
    const categoriesJson = JSON.stringify(
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        sort_order: c.sort_order,
      })),
      null,
      2,
    )
    archive.append(categoriesJson, { name: 'categories.json' })
    structuredSize += Buffer.byteLength(categoriesJson, 'utf-8')

    // ---- features/{id}.json ----
    for (const feature of features) {
      const sections = JSON.parse(feature.sections || '[]')
      const featureJson = JSON.stringify(
        {
          id: feature.id,
          title: feature.title,
          description: feature.description,
          sections, // 原生数组
          is_custom: feature.is_custom,
          category_id: feature.category_id,
        },
        null,
        2,
      )
      archive.append(featureJson, { name: `features/${feature.id}.json` })
      structuredSize += Buffer.byteLength(featureJson, 'utf-8')
    }

    // ---- documents/{feature-id}/{section-key}.html ----
    let docIdx = 0
    const totalDocs = docIds.length
    for (const docId of docIds) {
      const row = docRows.get(docId)
      if (!row) continue

      const snapshot = docSnapshots.get(docId) ?? null
      const updates = docUpdates.get(docId) ?? []

      // 解码 Y.js → HTML
      const html = yjsDataToHtml(snapshot, updates)
      if (!html.trim()) {
        docIdx++
        continue
      }

      // 绝对路径 → 相对路径
      const relHtml = absoluteToRelativeUploadPaths(html)

      archive.append(relHtml, {
        name: `documents/${row.feature_id}/${row.section_key}.html`,
      })
      structuredSize += Buffer.byteLength(relHtml, 'utf-8')

      docIdx++
      const pct = 10 + Math.floor((docIdx / Math.max(totalDocs, 1)) * 30)
      updateProgress(pct, `正在导出文档 ${docIdx}/${totalDocs}...`)
    }

    // ---- catalogs/{id}.json ----
    for (const cat of catalogs) {
      const versions = (catalogVersions[cat.id] || []).map((v) => ({
        id: v.id,
        catalog_id: v.catalog_id,
        version_major: v.version_major,
        version_minor: v.version_minor,
        title: v.title,
        features_snapshot: v.features_snapshot,
        change_notes: v.change_notes,
        markdown: v.markdown,
        status_snapshot: v.status_snapshot,
        visibility: v.visibility,
        features_json: v.features_json,
        headings_json: v.headings_json,
        publish_scope: v.publish_scope,
        status: v.status,
        created_at: v.created_at,
      }))

      const catalogJson = JSON.stringify(
        {
          id: cat.id,
          title: cat.title,
          features: JSON.parse(cat.features || '[]'),
          cover_info: JSON.parse(cat.cover_info || '{}'),
          versions,
        },
        null,
        2,
      )
      archive.append(catalogJson, { name: `catalogs/${cat.id}.json` })
      structuredSize += Buffer.byteLength(catalogJson, 'utf-8')
    }

    summary.structuredSize = structuredSize

    // ---- uploads/ 目录 ----
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
      const pct = 40 + Math.floor((completedFiles / Math.max(totalFiles, 1)) * 55)
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
