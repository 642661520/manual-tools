// ============================================================
// 导入服务：解析 ZIP → 差异分析 → 执行导入
// ============================================================

import { getDb } from '../db/index.js'
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import unzipper from 'unzipper'
import { config } from '../config.js'
import type {
  ImportDiffReport,
  ImportApplyOptions,
  ImportApplyResult,
} from '../../shared/types/models.js'
import type { FeatureRow, CatalogRow, CategoryRow } from '../types.js'

const UPLOAD_BASE = config.uploadDir

/** 标准化上传文件引用路径为分片格式
 *  新格式: images/ab/hash.ext → 保持不变
 *  旧格式: images/hash.ext → 转换为 images/ab/hash.ext */
function normalizeUploadRef(ref: string): string {
  const parts = ref.split('/')
  // parts[0] = images|videos, parts[1] = shard(2 hex) 或 filename(hash.ext)
  if (parts.length === 3) return ref // 已是分片格式
  if (parts.length === 2) {
    const filename = parts[1]
    const hash = filename.replace(/\.[^.]+$/, '')
    if (/^[a-f0-9]{64}$/.test(hash)) {
      return `${parts[0]}/${hash.slice(0, 2)}/${filename}`
    }
  }
  return ref
}

interface ExportData {
  data: {
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
    documents: Record<
      string,
      {
        row: {
          id: string
          feature_id: string
          section_key: string
          status: string
          assignees: string
          review_note: string
          review_step: number
          status_log: string
        }
        snapshot: string | null
        updates: string[]
      }
    >
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
    projectMembers: string[]
  }
  uploadsManifest: Array<{ path: string; size: number }>
}

/** 从 ZIP 中读取并解析 data.json */
async function parseDataJson(zipPath: string): Promise<ExportData> {
  const directory = await unzipper.Open.file(zipPath)
  const dataFile = directory.files.find((f: unzipper.File) => f.path === 'data.json')
  if (!dataFile) throw new Error('ZIP 文件中缺少 data.json')

  const buf = await dataFile.buffer()
  const content: string = buf.toString('utf-8')
  return JSON.parse(content)
}

/** 列出 ZIP 中的上传文件路径 */
async function listZipUploads(zipPath: string): Promise<string[]> {
  const directory = await unzipper.Open.file(zipPath)
  return directory.files
    .filter((f: unzipper.File) => f.path.startsWith('uploads/') && f.type === 'File')
    .map((f: unzipper.File) => f.path.replace(/^uploads\//, ''))
}

/** 差异分析 */
export async function analyzeImport(
  zipPath: string,
  targetProjectId: string,
): Promise<ImportDiffReport> {
  const db = getDb()
  const data = await parseDataJson(zipPath)

  const sourceProject = data.data.project
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
  for (const c of data.data.categories) {
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
  for (const f of data.data.features) {
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
  for (const c of data.data.catalogs) {
    const ex = existingCatlMap.get(c.row.id)
    if (!ex) {
      catlAdded.push(c.row.id)
    } else {
      catlConflicted.push({ id: c.row.id, sourceTitle: c.row.title, targetTitle: ex.title })
    }
  }

  // ---- 文档 ----
  const docIds = Object.keys(data.data.documents)
  const existingDocIds = new Set(
    (db.prepare('SELECT id FROM documents').all() as { id: string }[]).map((r) => r.id),
  )
  let docAdded = 0
  let docConflicted = 0
  for (const docId of docIds) {
    if (existingDocIds.has(docId)) {
      docConflicted++
    } else {
      docAdded++
    }
  }

  // ---- 成员 ----
  const existingMemberIds = new Set(
    (
      db
        .prepare('SELECT user_id FROM project_members WHERE project_id = ?')
        .all(targetProjectId) as { user_id: string }[]
    ).map((r) => r.user_id),
  )
  const existingUserIds = new Set(
    (db.prepare('SELECT id FROM users').all() as { id: string }[]).map((r) => r.id),
  )

  const memberAdded: string[] = []
  const unknownUsers: string[] = []
  for (const uid of data.data.projectMembers) {
    if (!existingMemberIds.has(uid)) {
      if (existingUserIds.has(uid)) {
        memberAdded.push(uid)
      } else {
        unknownUsers.push(uid)
      }
    }
  }

  // ---- 上传文件 ----
  const zipUploads = (await listZipUploads(zipPath)).map(normalizeUploadRef)
  let uploadsTotalSize = 0
  let uploadDuplicates = 0
  for (const ref of zipUploads) {
    const fp = path.join(UPLOAD_BASE, ref)
    if (fs.existsSync(fp)) {
      uploadDuplicates++
    }
    const manifest = data.uploadsManifest.find((m) => normalizeUploadRef(m.path) === ref)
    if (manifest) uploadsTotalSize += manifest.size
  }

  return {
    sourceProject: { id: sourceProject.id, name: sourceProject.name },
    categories: { added: catAdded, conflicted: catConflicted },
    features: { added: featAdded, conflicted: featConflicted },
    catalogs: { added: catlAdded, conflicted: catlConflicted },
    documents: { added: docAdded, conflicted: docConflicted, skipped: 0 },
    projectMembers: { added: memberAdded, unknownUsers },
    uploads: {
      total: zipUploads.length,
      totalSize: uploadsTotalSize,
      duplicates: uploadDuplicates,
    },
  }
}

/** 执行导入 */
export async function applyImport(
  zipPath: string,
  targetProjectId: string,
  options: ImportApplyOptions,
): Promise<ImportApplyResult> {
  const db = getDb()
  const data = await parseDataJson(zipPath)

  const result: ImportApplyResult = {
    categories: { inserted: 0, updated: 0, skipped: 0 },
    features: { inserted: 0, updated: 0, skipped: 0 },
    catalogs: { inserted: 0, updated: 0, skipped: 0 },
    documents: { inserted: 0, updated: 0, skipped: 0 },
    members: { inserted: 0 },
    uploads: { copied: 0, skipped: 0 },
  }

  const transaction = db.transaction(() => {
    // ---- 分类 ----
    const insertCat = db.prepare(`
      INSERT OR REPLACE INTO categories (id, name, color, sort_order, project_id)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const c of data.data.categories) {
      const existing = db
        .prepare('SELECT id FROM categories WHERE id = ? AND project_id = ?')
        .get(c.id, targetProjectId)
      if (existing) {
        // 安全默认：只有用户明确选择 'overwrite' 才覆盖，否则跳过
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
    for (const f of data.data.features) {
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
    for (const c of data.data.catalogs) {
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
    const insertUpdate = db.prepare(
      'INSERT INTO document_updates (document_id, update_data) VALUES (?, ?)',
    )
    const insertSnapshot = db.prepare(
      'INSERT INTO document_snapshots (document_id, snapshot_data) VALUES (?, ?)',
    )

    for (const [docId, docData] of Object.entries(data.data.documents)) {
      const r = docData.row
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
      insertDoc.run(
        r.id,
        r.feature_id,
        r.section_key,
        r.status,
        r.assignees,
        r.review_note,
        r.review_step,
        r.status_log,
      )

      // 先清理旧的 updates/snapshots（覆盖模式下）
      if (existing) {
        db.prepare('DELETE FROM document_updates WHERE document_id = ?').run(docId)
        db.prepare('DELETE FROM document_snapshots WHERE document_id = ?').run(docId)
      }
      if (docData.snapshot) {
        insertSnapshot.run(docId, Buffer.from(docData.snapshot, 'base64'))
      }
      for (const upd of docData.updates) {
        insertUpdate.run(docId, Buffer.from(upd, 'base64'))
      }
    }

    // ---- 成员 ----
    if (options.includeMembers) {
      const insertMember = db.prepare(
        'INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)',
      )
      for (const uid of data.data.projectMembers) {
        const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(uid)
        if (existingUser) {
          insertMember.run(targetProjectId, uid)
          result.members.inserted++
        }
      }
    }
  })

  transaction()

  // ---- 上传文件（在事务外，从 ZIP 流式解压） ----
  const directory = await unzipper.Open.file(zipPath)
  for (const file of directory.files) {
    if (!file.path.startsWith('uploads/') || file.type !== 'File') continue
    const ref: string = normalizeUploadRef(file.path.replace(/^uploads\//, ''))
    const destPath = path.join(UPLOAD_BASE, ref)

    // SHA-256 去重
    if (fs.existsSync(destPath)) {
      const content = await file.buffer()
      const hash = createHash('sha256').update(content).digest('hex')
      const fileName = path.basename(destPath)
      const expectedHash = fileName.replace(/\.[^.]+$/, '')
      if (hash === expectedHash) {
        result.uploads.skipped++
        continue
      }
    }

    const destDir = path.dirname(destPath)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    fs.writeFileSync(destPath, await file.buffer())
    result.uploads.copied++
  }

  return result
}
