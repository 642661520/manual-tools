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
  ImportDiffReport, ImportApplyOptions, ImportApplyResult,
} from '../../shared/types/models.js'
import type { FeatureRow, CatalogRow, CategoryRow } from '../types.js'

const UPLOAD_BASE = config.uploadDir

interface ExportData {
  data: {
    project: { id: string; name: string; description: string }
    categories: Array<{ id: string; name: string; color: string; sort_order: number }>
    features: Array<{
      id: string; title: string; description: string
      sections: string; is_custom: number; category_id: string | null
    }>
    documents: Record<string, {
      row: { id: string; feature_id: string; section_key: string; status: string
        assignees: string; review_note: string; review_step: number; review_log: string }
      snapshot: string | null
      updates: string[]
    }>
    catalogs: Array<{
      row: { id: string; title: string; targets: string; features: string; cover_info: string }
      versions: Array<{
        id: string; catalog_id: string; version_major: number; version_minor: number; title: string
        features_snapshot: string; change_notes: string; markdown: string
        status_snapshot: string; visibility: string; created_at: string
      }>
    }>
    projectMembers: string[]
  }
  uploadsManifest: Array<{ path: string; size: number }>
}

/** 从 ZIP 中读取并解析 data.json */
function parseDataJson(zipPath: string): ExportData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directory: any = unzipper.Open.file(zipPath)
  const dataFile = directory.files.find(
    (f: { path: string }) => f.path === 'data.json',
  )
  if (!dataFile) throw new Error('ZIP 文件中缺少 data.json')

  const content: string = dataFile.buffer().toString('utf-8')
  return JSON.parse(content)
}

/** 列出 ZIP 中的上传文件路径 */
function listZipUploads(zipPath: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directory: any = unzipper.Open.file(zipPath)
  return directory.files
    .filter((f: { path: string; type: string }) => f.path.startsWith('uploads/') && f.type === 'File')
    .map((f: { path: string }) => f.path.replace(/^uploads\//, ''))
}

/** 差异分析 */
export function analyzeImport(zipPath: string, targetProjectId: string): ImportDiffReport {
  const db = getDb()
  const data = parseDataJson(zipPath)

  const sourceProject = data.data.project
  const targetProject = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(
    targetProjectId,
  ) as { id: string; name: string } | undefined
  if (!targetProject) throw new Error('目标项目不存在')

  // ---- 分类 ----
  const existingCategories = db.prepare(
    'SELECT * FROM categories WHERE project_id = ?',
  ).all(targetProjectId) as CategoryRow[]
  const existingCatMap = new Map(existingCategories.map(c => [c.id, c]))

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
  const existingFeatures = db.prepare(
    'SELECT * FROM features WHERE project_id = ?',
  ).all(targetProjectId) as FeatureRow[]
  const existingFeatMap = new Map(existingFeatures.map(f => [f.id, f]))

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
  const existingCatalogs = db.prepare(
    'SELECT * FROM catalogs WHERE project_id = ?',
  ).all(targetProjectId) as CatalogRow[]
  const existingCatlMap = new Map(existingCatalogs.map(c => [c.id, c]))

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
    (db.prepare('SELECT id FROM documents').all() as { id: string }[]).map(r => r.id),
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
    (db.prepare(
      'SELECT user_id FROM project_members WHERE project_id = ?',
    ).all(targetProjectId) as { user_id: string }[]).map(r => r.user_id),
  )
  const existingUserIds = new Set(
    (db.prepare('SELECT id FROM users').all() as { id: string }[]).map(r => r.id),
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
  const zipUploads = listZipUploads(zipPath)
  let uploadsTotalSize = 0
  let uploadDuplicates = 0
  for (const ref of zipUploads) {
    const fp = path.join(UPLOAD_BASE, ref)
    if (fs.existsSync(fp)) {
      uploadDuplicates++
    }
    const manifest = data.uploadsManifest.find(m => m.path === ref)
    if (manifest) uploadsTotalSize += manifest.size
  }

  return {
    sourceProject: { id: sourceProject.id, name: sourceProject.name },
    categories: { added: catAdded, conflicted: catConflicted },
    features: { added: featAdded, conflicted: featConflicted },
    catalogs: { added: catlAdded, conflicted: catlConflicted },
    documents: { added: docAdded, conflicted: docConflicted, skipped: 0 },
    projectMembers: { added: memberAdded, unknownUsers },
    uploads: { total: zipUploads.length, totalSize: uploadsTotalSize, duplicates: uploadDuplicates },
  }
}

/** 执行导入 */
export function applyImport(
  zipPath: string,
  targetProjectId: string,
  options: ImportApplyOptions,
): ImportApplyResult {
  const db = getDb()
  const data = parseDataJson(zipPath)

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
      const existing = db.prepare('SELECT id FROM categories WHERE id = ? AND project_id = ?').get(c.id, targetProjectId)
      if (existing) {
        if (options.strategies.categories[c.id] === 'skip') {
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
      const existing = db.prepare('SELECT id FROM features WHERE id = ? AND project_id = ?').get(f.id, targetProjectId)
      if (existing) {
        if (options.strategies.features[f.id] === 'skip') {
          result.features.skipped++
          continue
        }
        result.features.updated++
      } else {
        result.features.inserted++
      }
      insertFeat.run(f.id, f.title, f.description, f.sections, f.is_custom, f.category_id, targetProjectId)
    }

    // ---- 目录 + 版本 ----
    const insertCatl = db.prepare(`
      INSERT OR REPLACE INTO catalogs (id, title, targets, features, cover_info, project_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    const insertVer = db.prepare(`
      INSERT OR REPLACE INTO catalog_versions
      (id, catalog_id, version_major, version_minor, title, features_snapshot, change_notes, markdown, status_snapshot, visibility, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const c of data.data.catalogs) {
      const existing = db.prepare('SELECT id FROM catalogs WHERE id = ? AND project_id = ?').get(c.row.id, targetProjectId)
      if (existing) {
        if (options.strategies.catalogs[c.row.id] === 'skip') {
          result.catalogs.skipped++
          continue
        }
        result.catalogs.updated++
      } else {
        result.catalogs.inserted++
      }
      insertCatl.run(c.row.id, c.row.title, c.row.targets, c.row.features, c.row.cover_info, targetProjectId)
      for (const v of c.versions) {
        insertVer.run(v.id, v.catalog_id, v.version_major, v.version_minor, v.title,
          v.features_snapshot, v.change_notes, v.markdown, v.status_snapshot, v.visibility, v.created_at)
      }
    }

    // ---- 文档 ----
    const insertDoc = db.prepare(`
      INSERT OR REPLACE INTO documents (id, feature_id, section_key, status, assignees, review_note, review_step, review_log, updated_at)
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
        if (options.strategies.documents[docId] === 'skip') {
          result.documents.skipped++
          continue
        }
        result.documents.updated++
      } else {
        result.documents.inserted++
      }
      insertDoc.run(r.id, r.feature_id, r.section_key, r.status, r.assignees, r.review_note, r.review_step, r.review_log)

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directory: any = unzipper.Open.file(zipPath)
  for (const file of directory.files) {
    if (!file.path.startsWith('uploads/') || file.type !== 'File') continue
    const ref: string = file.path.replace(/^uploads\//, '')
    const destPath = path.join(UPLOAD_BASE, ref)

    // SHA-256 去重
    if (fs.existsSync(destPath)) {
      const content: Buffer = file.buffer()
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
    fs.writeFileSync(destPath, file.buffer())
    result.uploads.copied++
  }

  return result
}
