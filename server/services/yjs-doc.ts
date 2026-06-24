import * as Y from 'yjs'
import { getDb } from '../db/index.js'
import type { WebSocket as WsSocket } from 'ws'

interface DocState {
  doc: Y.Doc
  clients: Set<WsSocket>
  updateCount: number
}

// 内存中的文档缓存
const docs = new Map<string, DocState>()

export function getOrCreateDoc(docId: string): DocState {
  let state = docs.get(docId)
  if (!state) {
    // 自动创建文档记录（确保 FK 约束不阻止 update 写入）
    ensureDocumentRecord(docId)

    const doc = new Y.Doc()
    loadFromDb(docId, doc)
    state = { doc, clients: new Set(), updateCount: 0 }
    docs.set(docId, state)

    // 监听更新 → 持久化到数据库
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'db-load') return
      persistUpdate(docId, update)
      state!.updateCount++
    })
  }
  return state
}

function ensureDocumentRecord(docId: string) {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM documents WHERE id = ?').get(docId)
  if (!existing) {
    // 解析 docId: {featureId}/{sectionKey}
    const idx = docId.indexOf('/')
    const featureId = idx >= 0 ? docId.slice(0, idx) : docId
    const sectionKey = idx >= 0 ? docId.slice(idx + 1) : 'main'
    db.prepare(
      'INSERT INTO documents (id, feature_id, section_key) VALUES (?, ?, ?)',
    ).run(docId, featureId, sectionKey)
  }
}

function loadFromDb(docId: string, doc: Y.Doc) {
  const db = getDb()

  // 先尝试加载最新快照
  const snapshot = db
    .prepare('SELECT snapshot_data FROM document_snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 1')
    .get(docId) as { snapshot_data: Buffer } | undefined

  if (snapshot) {
    Y.applyUpdate(doc, new Uint8Array(snapshot.snapshot_data), 'db-load')
  }

  // 加载快照之后的增量更新
  const updates = db
    .prepare('SELECT update_data FROM document_updates WHERE document_id = ? ORDER BY id ASC')
    .all(docId) as { update_data: Buffer }[]

  for (const row of updates) {
    Y.applyUpdate(doc, new Uint8Array(row.update_data), 'db-load')
  }
}

function persistUpdate(docId: string, update: Uint8Array) {
  const db = getDb()

  // 确保文档记录存在，首次编辑自动升级为 in_progress
  const idx = docId.indexOf('/')
  const featureId = idx >= 0 ? docId.slice(0, idx) : docId
  const sectionKey = idx >= 0 ? docId.slice(idx + 1) : 'main'

  const existing = db.prepare('SELECT status FROM documents WHERE id = ?').get(docId) as { status: string } | undefined
  if (!existing) {
    db.prepare(
      'INSERT INTO documents (id, feature_id, section_key, status) VALUES (?, ?, ?, ?)',
    ).run(docId, featureId, sectionKey, 'in_progress')
  } else if (existing.status === 'draft') {
    db.prepare("UPDATE documents SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(docId)
  }

  db.prepare('INSERT INTO document_updates (document_id, update_data) VALUES (?, ?)').run(
    docId,
    Buffer.from(update),
  )

  // 更新文档的 updated_at
  db.prepare("UPDATE documents SET updated_at = datetime('now') WHERE id = ?").run(docId)
}

// 确保文档记录存在
export function ensureDocument(docId: string, featureId: string, sectionKey: string) {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM documents WHERE id = ?').get(docId)
  if (!existing) {
    db.prepare(
      'INSERT INTO documents (id, feature_id, section_key) VALUES (?, ?, ?)',
    ).run(docId, featureId, sectionKey)
  }
}

// 编码当前状态向量
export function getStateVector(docId: string): Uint8Array {
  const state = docs.get(docId)
  if (!state) return new Uint8Array()
  return Y.encodeStateAsUpdate(state.doc)
}

// 根据状态向量编码差异更新
export function encodeStateAsUpdate(docId: string, remoteStateVector: Uint8Array): Uint8Array {
  const state = docs.get(docId)
  if (!state) return new Uint8Array()
  return Y.encodeStateAsUpdate(state.doc, remoteStateVector)
}

// 应用更新
export function applyUpdate(docId: string, update: Uint8Array) {
  const state = docs.get(docId)
  if (state) {
    Y.applyUpdate(state.doc, update)
  }
}

// 订阅文档更新（用于广播）
export function onUpdate(docId: string, callback: (update: Uint8Array) => void) {
  const state = docs.get(docId)
  if (!state) return () => {}
  const handler = (update: Uint8Array, origin: unknown) => {
    if (origin === 'db-load') return
    callback(update)
  }
  state.doc.on('update', handler)
  return () => state.doc.off('update', handler)
}

// 获取当前 snapshot 阈值
export function getSnapshotThreshold() {
  return parseInt(process.env.YJS_SNAPSHOT_UPDATE_THRESHOLD || '500')
}

// 创建快照
export function createSnapshot(docId: string) {
  const state = docs.get(docId)
  if (!state) return

  const db = getDb()
  const snapshot = Y.encodeStateAsUpdate(state.doc)

  db.prepare('INSERT INTO document_snapshots (document_id, snapshot_data, update_count) VALUES (?, ?, ?)').run(
    docId,
    Buffer.from(snapshot),
    state.updateCount,
  )

  // 删除快照时间点之前的 update 记录
  db.prepare('DELETE FROM document_updates WHERE document_id = ?').run(docId)
  state.updateCount = 0

  console.log(`Snapshot created for ${docId}`)
}
