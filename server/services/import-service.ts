// ============================================================
// 导入服务：解析 ZIP → 差异分析 → 执行导入
// v2 格式：按实体类型拆分文件，文档为 HTML，图片用相对路径
// ============================================================

import { getDb } from '../db/index.js'
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import unzipper from 'unzipper'
import { config } from '../config.js'
import { htmlToYjsSnapshot } from '../lib/yjs-utils.js'
import { parseRelativeUploadRef } from '../lib/upload-refs.js'
import type {
  ImportDiffReport,
  ImportApplyOptions,
  ImportApplyResult,
} from '../../shared/types/models.js'
import type { FeatureRow, CatalogRow, CategoryRow } from '../types.js'
import type { CentralDirectory, File as UnzipFile } from 'unzipper'

const UPLOAD_BASE = config.uploadDir

// ---- ZIP 文件读取辅助 ----

/** 规范化 ZIP 内路径：去除前导 ./ 或 / */
function normPath(p: string): string {
  return p.replace(/^\.?\//, '')
}

class V2ZipReader {
  constructor(private directory: CentralDirectory) {}

  getFile(path: string): UnzipFile | undefined {
    const target = normPath(path)
    return this.directory.files.find((f: UnzipFile) => normPath(f.path) === target)
  }

  async readJson(relPath: string): Promise<Record<string, unknown>> {
    const file = this.getFile(relPath)
    if (!file) throw new Error(`ZIP 中缺少 ${relPath}`)
    const buf = await file.buffer()
    return JSON.parse(buf.toString('utf-8'))
  }

  async readText(relPath: string): Promise<string> {
    const file = this.getFile(relPath)
    if (!file) return ''
    const buf = await file.buffer()
    return buf.toString('utf-8')
  }

  listFiles(prefix: string): string[] {
    const target = normPath(prefix)
    return this.directory.files
      .filter((f: UnzipFile) => normPath(f.path).startsWith(target) && f.type === 'File')
      .map((f: UnzipFile) => f.path)
  }
}

// ---- 数据解析 ----

interface ParsedExport {
  source: { projectId: string; projectName: string }
  project: { id: string; name: string; description: string }
  categories: Array<{ id: string; name: string; color: string; sort_order: number }>
  features: Array<{
    id: string
    title: string
    description: string
    sections: string
    is_custom: number
    category_id: string | null
  }>
  documents: Map<string, { html: string; featureId: string; sectionKey: string }>
  catalogs: Array<{
    row: { id: string; title: string; targets: string; features: string; cover_info: string }
    versions: Array<{
      id: string
      catalog_id: string
      version_major: number
      version_minor: number
      title: string
      features_snapshot: string
      change_notes: string
      markdown: string
      status_snapshot: string
      visibility: string
      features_json: string
      headings_json: string
      created_at: string
    }>
  }>
}

async function parseExportData(zipPath: string): Promise<ParsedExport> {
  const directory = await unzipper.Open.file(zipPath)
  const reader = new V2ZipReader(directory)

  // manifest.json
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manifest = await reader.readJson('manifest.json') as any
  const source = {
    projectId: (manifest.source?.projectId as string) ?? '',
    projectName: (manifest.source?.projectName as string) ?? 'Unknown',
  }

  // project.json
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const project = await reader.readJson('project.json') as any as ParsedExport['project']

  // categories.json
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories = await reader.readJson('categories.json') as any as ParsedExport['categories']

  // features/*.json
  const featurePaths = reader.listFiles('features/')
  const features: ParsedExport['features'] = []
  for (const fp of featurePaths) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = await reader.readJson(fp) as any
    features.push({
      id: f.id as string,
      title: f.title as string,
      description: f.description as string,
      sections: JSON.stringify(f.sections || []),
      is_custom: (f.is_custom as number) ?? 0,
      category_id: (f.category_id as string) ?? null,
    })
  }

  // documents/*/*.html
  const documentPaths = reader.listFiles('documents/')
  const documents = new Map<string, { html: string; featureId: string; sectionKey: string }>()

  for (const dp of documentPaths) {
    // dp = "documents/{feature-id}/{section-key}.html"
    const relative = dp.replace('documents/', '')
    const lastSlash = relative.lastIndexOf('/')
    if (lastSlash < 0) continue
    const featureId = relative.slice(0, lastSlash)
    const sectionKey = relative.slice(lastSlash + 1).replace(/\.html$/, '')
    const docId = `${featureId}/${sectionKey}`
    const html = await reader.readText(dp)
    if (!html.trim()) continue
    documents.set(docId, { html, featureId, sectionKey })
  }

  // catalogs/*.json
  const catalogPaths = reader.listFiles('catalogs/')
  const catalogs: ParsedExport['catalogs'] = []
  for (const cp of catalogPaths) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = await reader.readJson(cp) as any
    catalogs.push({
      row: {
        id: c.id as string,
        title: c.title as string,
        targets: JSON.stringify(c.targets || []),
        features: JSON.stringify(c.features || []),
        cover_info: JSON.stringify(c.cover_info || {}),
      },
      versions: (c.versions || []).map((v: Record<string, unknown>) => ({
        id: v.id as string,
        catalog_id: v.catalog_id as string,
        version_major: v.version_major as number,
        version_minor: v.version_minor as number,
        title: v.title as string,
        features_snapshot: v.features_snapshot as string,
        change_notes: v.change_notes as string,
        markdown: v.markdown as string,
        status_snapshot: v.status_snapshot as string,
        visibility: v.visibility as string,
        features_json: (v.features_json as string) || '[]',
        headings_json: (v.headings_json as string) || '[]',
        created_at: v.created_at as string,
      })),
    })
  }

  return { source, project, categories, features, documents, catalogs }
}

/**
 * 扫描 HTML 中的相对路径 uploads 引用，解析为 ZIP 内路径
 * 返回 [relPath, { zipPath, filename, isHashed }] 映射
 */
function collectRelativeUploadRefs(
  html: string,
): Map<string, { zipPath: string; filename: string; isHashed: boolean }> {
  const refs = new Map<string, { zipPath: string; filename: string; isHashed: boolean }>()
  const re = /\.\.\/\.\.\/uploads\/(images|videos)\/([a-f0-9]{2}\/)?([^"'\s>]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const relPath = m[0]
    if (refs.has(relPath)) continue
    const parsed = parseRelativeUploadRef(relPath)
    if (parsed) refs.set(relPath, parsed)
  }
  return refs
}

/**
 * 构建上传文件路径映射：ZIP 内路径 → 最终绝对 URL 路径
 * 非 hash 文件名自动计算 SHA-256
 */
async function buildUploadMapping(
  zipPath: string,
  documents: Map<string, { html: string; featureId: string; sectionKey: string }>,
): Promise<Map<string, string>> {
  const directory = await unzipper.Open.file(zipPath)
  const mapping = new Map<string, string>() // zipPath → absolute URL

  for (const [, doc] of documents) {
    const refs = collectRelativeUploadRefs(doc.html)
    for (const [, parsed] of refs) {
      if (mapping.has(parsed.zipPath)) continue

      const zipFile = directory.files.find(
        (f: UnzipFile) => f.path === parsed.zipPath && f.type === 'File',
      )
      if (!zipFile) continue

      if (parsed.isHashed) {
        // 已哈希：直接使用
        mapping.set(parsed.zipPath, `/uploads/${parsed.zipPath.replace('uploads/', '')}`)
      } else {
        // 非哈希：计算 SHA-256
        const content = await zipFile.buffer()
        const hash = createHash('sha256').update(content).digest('hex')
        const ext = path.extname(parsed.filename)
        const zipBase = parsed.zipPath.replace(/[^/]+$/, '') // "uploads/images/" or "uploads/images/ab/"
        // 确保分片目录存在
        const shard = hash.slice(0, 2)
        const finalDir = zipBase.includes(`/${shard}/`) ? zipBase : `${zipBase}${shard}/`
        const finalZipPath = `${finalDir}${hash}${ext}`
        mapping.set(parsed.zipPath, `/uploads/${finalZipPath.replace('uploads/', '')}`)
      }
    }
  }

  return mapping
}

/**
 * 用映射表替换 HTML 中的相对路径为绝对路径
 */
function rewriteUploadPaths(html: string, mapping: Map<string, string>): string {
  let result = html
  for (const [relPath, absoluteUrl] of mapping) {
    // 转义特殊正则字符
    const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escaped, 'g'), absoluteUrl)
  }
  return result
}

// ---- 差异分析 ----

export async function analyzeImport(
  zipPath: string,
  targetProjectId: string,
): Promise<ImportDiffReport> {
  const db = getDb()
  const data = await parseExportData(zipPath)

  const targetProject = db
    .prepare('SELECT id, name FROM projects WHERE id = ?')
    .get(targetProjectId) as { id: string; name: string } | undefined
  if (!targetProject) throw new Error('目标项目不存在')

  // ---- 分类 ----
  const existingCategories = db
    .prepare('SELECT * FROM categories WHERE project_id = ?')
    .all(targetProjectId) as CategoryRow[]
  const existingCatMap = new Map(existingCategories.map((c) => [c.id, c]))

  const catAdded: string[] = []
  const catConflicted: { id: string; sourceName: string; targetName: string }[] = []
  for (const c of data.categories) {
    const ex = existingCatMap.get(c.id)
    if (!ex) {
      catAdded.push(c.id)
    } else {
      catConflicted.push({ id: c.id, sourceName: c.name, targetName: ex.name })
    }
  }

  // ---- 功能 ----
  const existingFeatures = db
    .prepare('SELECT * FROM features WHERE project_id = ?')
    .all(targetProjectId) as FeatureRow[]
  const existingFeatMap = new Map(existingFeatures.map((f) => [f.id, f]))

  const featAdded: string[] = []
  const featConflicted: { id: string; sourceTitle: string; targetTitle: string }[] = []
  for (const f of data.features) {
    const ex = existingFeatMap.get(f.id)
    if (!ex) {
      featAdded.push(f.id)
    } else {
      featConflicted.push({ id: f.id, sourceTitle: f.title, targetTitle: ex.title })
    }
  }

  // ---- 目录 ----
  const existingCatalogs = db
    .prepare('SELECT * FROM catalogs WHERE project_id = ?')
    .all(targetProjectId) as CatalogRow[]
  const existingCatlMap = new Map(existingCatalogs.map((c) => [c.id, c]))

  const catlAdded: string[] = []
  const catlConflicted: { id: string; sourceTitle: string; targetTitle: string }[] = []
  for (const c of data.catalogs) {
    const ex = existingCatlMap.get(c.row.id)
    if (!ex) {
      catlAdded.push(c.row.id)
    } else {
      catlConflicted.push({ id: c.row.id, sourceTitle: c.row.title, targetTitle: ex.title })
    }
  }

  // ---- 文档 ----
  const existingDocIds = new Set(
    (db.prepare('SELECT id FROM documents').all() as { id: string }[]).map((r) => r.id),
  )
  let docAdded = 0
  let docConflicted = 0
  for (const docId of data.documents.keys()) {
    if (existingDocIds.has(docId)) {
      docConflicted++
    } else {
      docAdded++
    }
  }

  // ---- 上传文件 ----
  const directory = await unzipper.Open.file(zipPath)
  const uploadPaths = directory.files
    .filter((f: UnzipFile) => f.path.startsWith('uploads/') && f.type === 'File')
    .map((f: UnzipFile) => f.path)

  let uploadsTotalSize = 0
  let uploadDuplicates = 0
  for (const up of uploadPaths) {
    const zipFile = directory.files.find((f: UnzipFile) => f.path === up)
    if (zipFile) {
      const content = await zipFile.buffer()
      uploadsTotalSize += content.length
    }
    // 检查是否已存在
    const rel = up.replace('uploads/', '')
    const diskPath = path.join(UPLOAD_BASE, rel)
    if (fs.existsSync(diskPath)) {
      uploadDuplicates++
    }
  }

  return {
    sourceProject: { id: data.source.projectId, name: data.source.projectName },
    categories: { added: catAdded, conflicted: catConflicted },
    features: { added: featAdded, conflicted: featConflicted },
    catalogs: { added: catlAdded, conflicted: catlConflicted },
    documents: { added: docAdded, conflicted: docConflicted, skipped: 0 },
    uploads: {
      total: uploadPaths.length,
      totalSize: uploadsTotalSize,
      duplicates: uploadDuplicates,
    },
  }
}

// ---- 执行导入 ----

export async function applyImport(
  zipPath: string,
  targetProjectId: string,
  options: ImportApplyOptions,
): Promise<ImportApplyResult> {
  const db = getDb()
  const data = await parseExportData(zipPath)

  const result: ImportApplyResult = {
    categories: { inserted: 0, updated: 0, skipped: 0 },
    features: { inserted: 0, updated: 0, skipped: 0 },
    catalogs: { inserted: 0, updated: 0, skipped: 0 },
    documents: { inserted: 0, updated: 0, skipped: 0 },
    uploads: { copied: 0, skipped: 0 },
  }

  // 构建上传路径映射（HTML 相对路径 → 绝对 URL）
  const uploadMapping = await buildUploadMapping(zipPath, data.documents)

  // 重写文档 HTML 中的路径
  const rewrittenDocs = new Map<string, string>() // docId → final HTML
  for (const [docId, doc] of data.documents) {
    rewrittenDocs.set(docId, rewriteUploadPaths(doc.html, uploadMapping))
  }

  const defaultStatus = options.documentStatus || 'draft'

  const transaction = db.transaction(() => {
    // ---- 分类 ----
    const insertCat = db.prepare(`
      INSERT OR REPLACE INTO categories (id, name, color, sort_order, project_id)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const c of data.categories) {
      const existing = db
        .prepare('SELECT id FROM categories WHERE id = ? AND project_id = ?')
        .get(c.id, targetProjectId)
      if (existing) {
        if (options.strategies.categories[c.id] !== 'overwrite') {
          result.categories.skipped++
          continue
        }
        result.categories.updated++
      } else {
        result.categories.inserted++
      }
      insertCat.run(c.id, c.name, c.color, c.sort_order, targetProjectId)
    }

    // ---- 功能 ----
    const insertFeat = db.prepare(`
      INSERT OR REPLACE INTO features (id, title, description, sections, is_custom, category_id, project_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    for (const f of data.features) {
      const existing = db
        .prepare('SELECT id FROM features WHERE id = ? AND project_id = ?')
        .get(f.id, targetProjectId)
      if (existing) {
        if (options.strategies.features[f.id] !== 'overwrite') {
          result.features.skipped++
          continue
        }
        result.features.updated++
      } else {
        result.features.inserted++
      }
      insertFeat.run(
        f.id,
        f.title,
        f.description,
        f.sections,
        f.is_custom,
        f.category_id,
        targetProjectId,
      )
    }

    // ---- 目录 + 版本 ----
    const insertCatl = db.prepare(`
      INSERT OR REPLACE INTO catalogs (id, title, targets, features, cover_info, project_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    const insertVer = db.prepare(`
      INSERT OR REPLACE INTO catalog_versions
      (id, catalog_id, version_major, version_minor, title, features_snapshot, change_notes, markdown, status_snapshot, visibility, features_json, headings_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const c of data.catalogs) {
      const existing = db
        .prepare('SELECT id FROM catalogs WHERE id = ? AND project_id = ?')
        .get(c.row.id, targetProjectId)
      if (existing) {
        if (options.strategies.catalogs[c.row.id] !== 'overwrite') {
          result.catalogs.skipped++
          continue
        }
        result.catalogs.updated++
      } else {
        result.catalogs.inserted++
      }
      insertCatl.run(
        c.row.id,
        c.row.title,
        c.row.targets,
        c.row.features,
        c.row.cover_info,
        targetProjectId,
      )
      for (const v of c.versions) {
        insertVer.run(
          v.id,
          v.catalog_id,
          v.version_major,
          v.version_minor,
          v.title,
          v.features_snapshot,
          v.change_notes,
          v.markdown,
          v.status_snapshot,
          v.visibility,
          v.features_json || '[]',
          v.headings_json || '[]',
          v.created_at,
        )
      }
    }

    // ---- 文档 ----
    const insertDoc = db.prepare(`
      INSERT OR REPLACE INTO documents (id, feature_id, section_key, status, assignees, review_note, review_step, status_log, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    const insertSnapshot = db.prepare(
      'INSERT INTO document_snapshots (document_id, snapshot_data) VALUES (?, ?)',
    )

    for (const [docId, doc] of data.documents) {
      const existing = db.prepare('SELECT id FROM documents WHERE id = ?').get(docId)
      if (existing) {
        if (options.strategies.documents[docId] !== 'overwrite') {
          result.documents.skipped++
          continue
        }
        result.documents.updated++
      } else {
        result.documents.inserted++
      }

      const finalHtml = rewrittenDocs.get(docId) || doc.html

      insertDoc.run(docId, doc.featureId, doc.sectionKey, defaultStatus, '[]', '', 0, '[]')

      // 清理旧的 updates/snapshots（覆盖模式下）
      if (existing) {
        db.prepare('DELETE FROM document_updates WHERE document_id = ?').run(docId)
        db.prepare('DELETE FROM document_snapshots WHERE document_id = ?').run(docId)
      }

      // HTML → Y.js snapshot
      const snapshotBuf = htmlToYjsSnapshot(finalHtml)
      insertSnapshot.run(docId, snapshotBuf)
    }
  })

  transaction()

  // ---- 上传文件（事务外） ----
  const directory = await unzipper.Open.file(zipPath)
  const uploadFiles = directory.files.filter(
    (f: UnzipFile) => f.path.startsWith('uploads/') && f.type === 'File',
  )

  for (const file of uploadFiles) {
    const zipPathRel = file.path // "uploads/images/ab/hash.png"
    const content = await file.buffer()

    // 查找映射中是否有此文件的目标路径
    const mappedUrl = uploadMapping.get(zipPathRel)
    let destRel: string

    if (mappedUrl) {
      // 从映射的绝对 URL 反推相对磁盘路径
      destRel = mappedUrl.replace(/^\/uploads\//, '')
    } else {
      // 未被文档引用的文件：检查是否 hash 命名
      const filename = path.basename(zipPathRel)
      const nameWithoutExt = filename.replace(/\.[^.]+$/, '')
      if (/^[a-f0-9]{64}$/.test(nameWithoutExt)) {
        destRel = zipPathRel.replace('uploads/', '')
      } else {
        // 非 hash 文件名：计算 hash
        const hash = createHash('sha256').update(content).digest('hex')
        const ext = path.extname(filename)
        destRel = `images/${hash.slice(0, 2)}/${hash}${ext}`
      }
    }

    const destPath = path.join(UPLOAD_BASE, destRel)

    // SHA-256 去重
    if (fs.existsSync(destPath)) {
      const existingContent = fs.readFileSync(destPath)
      const existingHash = createHash('sha256').update(existingContent).digest('hex')
      const newHash = createHash('sha256').update(content).digest('hex')
      if (existingHash === newHash) {
        result.uploads.skipped++
        continue
      }
    }

    const destDir = path.dirname(destPath)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    fs.writeFileSync(destPath, content)
    result.uploads.copied++
  }

  return result
}
