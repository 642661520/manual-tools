/**
 * 全文搜索服务 — LIKE 搜索，每处出现一条结果
 */
import * as Y from 'yjs'
import { getDb } from '../db/index.js'
import { getLogger } from '../lib/logger.js'

const log = getLogger()

export interface SearchResult {
  docId: string
  featureId: string
  sectionKey: string
  title: string
  sectionTitle: string
  snippet: string
}

export function indexDocument(
  docId: string,
  projectId: string,
  title: string,
  htmlContent: string,
) {
  const db = getDb()
  const text = stripHtml(htmlContent)
  const sectionKey = docId.includes('/') ? docId.split('/')[1] : '_default'
  if (text) {
    db.prepare(
      'INSERT OR REPLACE INTO search_docs (doc_id, title, content, project_id, section_key) VALUES (?, ?, ?, ?, ?)',
    ).run(docId, title, text, projectId, sectionKey)
  } else {
    db.prepare('DELETE FROM search_docs WHERE doc_id = ?').run(docId)
  }
}

export function removeDocument(docId: string) {
  getDb().prepare('DELETE FROM search_docs WHERE doc_id = ?').run(docId)
}

export function searchDocs(query: string, projectId: string, limit = 50): SearchResult[] {
  const q = query.trim()
  if (!q) return []
  const db = getDb()
  const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
  const rows = db
    .prepare(`
    SELECT doc_id, title, section_key, content FROM search_docs
    WHERE (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') AND project_id = ?
  `)
    .all(like, like, projectId) as {
    doc_id: string
    title: string
    section_key: string
    content: string
  }[]

  const results: SearchResult[] = []
  for (const r of rows) {
    const fid = r.doc_id.includes('/') ? r.doc_id.split('/')[0] : r.doc_id
    const st = getSectionTitle(r.doc_id, r.section_key, r.title)
    for (const s of findAllSnippets(r.content, q)) {
      if (results.length >= limit) break
      results.push({
        docId: r.doc_id,
        featureId: fid,
        sectionKey: r.section_key,
        title: r.title,
        sectionTitle: st,
        snippet: s,
      })
    }
    if (results.length >= limit) break
  }
  return results
}

function findAllSnippets(text: string, query: string): string[] {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, 'gi')
  const seen = new Set<number>() // 记录已用过的起始位置，去重
  const snippets: string[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    const idx = m.index
    // 取当前匹配位置前后各 40 字符
    const start = Math.max(0, idx - 40)
    if (seen.has(start)) continue // 同一窗口已输出过
    seen.add(start)
    const end = Math.min(text.length, idx + query.length + 40)
    let s = text.slice(start, end)
    s = s.replace(regex, '<mark>$&</mark>')
    snippets.push((start > 0 ? '...' : '') + s + (end < text.length ? '...' : ''))
    if (snippets.length >= 50) break
  }
  return snippets
}

export function rebuildProjectIndex(projectId: string) {
  const db = getDb()
  db.prepare('DELETE FROM search_docs WHERE project_id = ?').run(projectId)
  const docs = db
    .prepare(`
    SELECT d.id, d.feature_id, f.title
    FROM documents d JOIN features f ON f.id = d.feature_id
    WHERE f.project_id = ?
  `)
    .all(projectId) as { id: string; feature_id: string; title: string }[]

  let count = 0
  for (const doc of docs) {
    const raw = loadYjsText(doc.id)
    const text = stripHtml(raw)
    if (text) {
      const sectionKey = doc.id.includes('/') ? doc.id.split('/')[1] : '_default'
      db.prepare(
        'INSERT OR REPLACE INTO search_docs (doc_id, title, content, project_id, section_key) VALUES (?, ?, ?, ?, ?)',
      ).run(doc.id, doc.title, text, projectId, sectionKey)
      count++
    }
  }
  log.info({ projectId, count }, 'search index rebuilt for project')
}

function loadYjsText(docId: string): string {
  const db = getDb()
  const ydoc = new Y.Doc()

  const snapshot = db
    .prepare(
      'SELECT snapshot_data FROM document_snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(docId) as { snapshot_data: Buffer } | undefined

  if (snapshot) {
    try {
      Y.applyUpdate(ydoc, new Uint8Array(snapshot.snapshot_data))
    } catch {
      /* skip */
    }
  }

  const updates = db
    .prepare('SELECT update_data FROM document_updates WHERE document_id = ? ORDER BY id ASC')
    .all(docId) as { update_data: Buffer }[]

  for (const row of updates) {
    try {
      Y.applyUpdate(ydoc, new Uint8Array(row.update_data))
    } catch {
      /* skip */
    }
  }

  const text = ydoc.getText('content').toString()
  ydoc.destroy()
  return text
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getSectionTitle(docId: string, sectionKey: string, fallback: string): string {
  if (sectionKey === '_default') return fallback
  const db = getDb()
  const idx = docId.indexOf('/')
  if (idx < 0) return fallback
  const feature = db
    .prepare('SELECT sections FROM features WHERE id = ?')
    .get(docId.slice(0, idx)) as { sections: string } | undefined
  if (!feature) return fallback
  try {
    const secs = JSON.parse(feature.sections || '[]') as { key: string; title: string }[]
    return secs.find((s) => s.key === sectionKey)?.title || fallback
  } catch {
    return fallback
  }
}
