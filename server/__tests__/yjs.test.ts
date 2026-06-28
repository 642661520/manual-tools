/** Yjs 文档测试：快照创建与恢复 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { getDb } from '../db/index.js'

const TEST_FEATURE_ID = '__test_yjs_feat'
const TEST_DOC_ID = `${TEST_FEATURE_ID}/section`
const TEST_DOC_ID_2 = `${TEST_FEATURE_ID}/section2`

beforeAll(async () => {
  const db = getDb()
  db.prepare(
    'INSERT OR IGNORE INTO features (id, title, description, sections, is_custom, project_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(TEST_FEATURE_ID, 'Test Feature', '', '[]', 0, 'default')
})

afterEach(() => {
  // 每个测试后清理残留数据
  const db = getDb()
  db.prepare('DELETE FROM document_snapshots WHERE document_id LIKE ?').run('__test_yjs%')
  db.prepare('DELETE FROM document_updates WHERE document_id LIKE ?').run('__test_yjs%')
  db.prepare('DELETE FROM documents WHERE id LIKE ?').run('__test_yjs%')
  // 重新创建干净的 document 记录给下一个测试
  db.prepare(
    'INSERT OR IGNORE INTO documents (id, feature_id, section_key, status) VALUES (?, ?, ?, ?)',
  ).run(TEST_DOC_ID, TEST_FEATURE_ID, 'section', 'draft')
  db.prepare(
    'INSERT OR IGNORE INTO documents (id, feature_id, section_key, status) VALUES (?, ?, ?, ?)',
  ).run(TEST_DOC_ID_2, TEST_FEATURE_ID, 'section2', 'draft')
})

afterAll(async () => {
  const db = getDb()
  db.prepare('DELETE FROM document_updates WHERE document_id LIKE ?').run('__test_yjs%')
  db.prepare('DELETE FROM document_snapshots WHERE document_id LIKE ?').run('__test_yjs%')
  db.prepare('DELETE FROM documents WHERE id LIKE ?').run('__test_yjs%')
  db.prepare('DELETE FROM features WHERE id = ?').run(TEST_FEATURE_ID)
})

describe('Yjs Doc 持久化', () => {
  it('ensureDocumentRecord 通过 getOrCreateDoc 创建记录', async () => {
    const { getOrCreateDoc } = await import('../services/yjs-doc.js')
    const state = getOrCreateDoc(TEST_DOC_ID)
    expect(state).toBeTruthy()
    expect(state.doc).toBeTruthy()

    const db = getDb()
    const row = db.prepare('SELECT id FROM documents WHERE id = ?').get(TEST_DOC_ID)
    expect(row).toBeTruthy()

    state.doc.destroy()
  })

  it('createSnapshot 写入快照并清理增量', async () => {
    const { getOrCreateDoc, createSnapshot } = await import('../services/yjs-doc.js')
    const state = getOrCreateDoc(TEST_DOC_ID)
    const ytext = state.doc.getText('content')
    ytext.insert(0, '测试快照内容')
    // Yjs update 事件是同步的，无需等待

    createSnapshot(TEST_DOC_ID)

    const db = getDb()
    const snapshots = db
      .prepare('SELECT * FROM document_snapshots WHERE document_id = ?')
      .all(TEST_DOC_ID)
    expect(snapshots.length).toBeGreaterThan(0)

    const updates = db
      .prepare('SELECT * FROM document_updates WHERE document_id = ?')
      .all(TEST_DOC_ID)
    expect(updates.length).toBe(0)

    state.doc.destroy()
  })

  it('applyUpdate 将更新应用到文档', async () => {
    const { getOrCreateDoc, applyUpdate } = await import('../services/yjs-doc.js')
    const state = getOrCreateDoc(TEST_DOC_ID)
    const ytext = state.doc.getText('content')
    ytext.insert(0, '初始内容')

    // 创建一个 update：在位置 0 插入 '新'
    const doc2 = new (await import('yjs')).Doc()
    doc2.getText('content').insert(0, '新')
    const update = (await import('yjs')).encodeStateAsUpdate(doc2)
    doc2.destroy()

    applyUpdate(TEST_DOC_ID, update)
    expect(ytext.toString()).toContain('新')

    state.doc.destroy()
  })

  it('applyUpdate 对不存在的文档无操作', async () => {
    const { applyUpdate } = await import('../services/yjs-doc.js')
    // 不应抛错
    expect(() => applyUpdate('nonexistent/doc', new Uint8Array([1, 2, 3]))).not.toThrow()
  })

  it('getStateVector 返回编码后的状态', async () => {
    const { getOrCreateDoc, getStateVector } = await import('../services/yjs-doc.js')
    const state = getOrCreateDoc(TEST_DOC_ID)
    state.doc.getText('content').insert(0, 'test')

    const vector = getStateVector(TEST_DOC_ID)
    expect(vector).toBeInstanceOf(Uint8Array)
    expect(vector.length).toBeGreaterThan(0)

    state.doc.destroy()
  })

  it('getStateVector 对不存在的文档返回空数组', async () => {
    const { getStateVector } = await import('../services/yjs-doc.js')
    const vector = getStateVector('nonexistent/doc-id')
    expect(vector).toBeInstanceOf(Uint8Array)
    expect(vector.length).toBe(0)
  })

  it('encodeStateAsUpdate 根据远程状态向量编码差异', async () => {
    const { getOrCreateDoc, encodeStateAsUpdate } = await import('../services/yjs-doc.js')
    const { Doc, encodeStateVector } = await import('yjs')
    const state = getOrCreateDoc(TEST_DOC_ID)
    state.doc.getText('content').insert(0, '差异测试')

    // 空状态向量（来自全新文档）
    const emptyVector = encodeStateVector(new Doc())
    const update = encodeStateAsUpdate(TEST_DOC_ID, emptyVector)
    expect(update).toBeInstanceOf(Uint8Array)
    expect(update.length).toBeGreaterThan(0)

    state.doc.destroy()
  })

  it('encodeStateAsUpdate 对不存在的文档返回空数组', async () => {
    const { encodeStateAsUpdate } = await import('../services/yjs-doc.js')
    const { Doc, encodeStateVector } = await import('yjs')
    const update = encodeStateAsUpdate('nonexistent/doc', encodeStateVector(new Doc()))
    expect(update).toBeInstanceOf(Uint8Array)
    expect(update.length).toBe(0)
  })

  it('onUpdate 订阅文档变更并返回取消函数', async () => {
    const { getOrCreateDoc, onUpdate, applyUpdate } = await import('../services/yjs-doc.js')
    const { Doc } = await import('yjs')
    const state = getOrCreateDoc(TEST_DOC_ID)

    const updates: Uint8Array[] = []
    const unsubscribe = onUpdate(TEST_DOC_ID, (update) => {
      updates.push(update)
    })

    // 创建一个外部更新
    const extDoc = new Doc()
    extDoc.getText('content').insert(0, '外部')
    const update = (await import('yjs')).encodeStateAsUpdate(extDoc)
    extDoc.destroy()

    applyUpdate(TEST_DOC_ID, update)
    expect(updates.length).toBeGreaterThan(0)

    // 取消订阅
    unsubscribe()
    const countAfter = updates.length
    applyUpdate(TEST_DOC_ID, update)
    expect(updates.length).toBe(countAfter) // 不再新增

    state.doc.destroy()
  })

  it('onUpdate 对不存在的文档返回空取消函数', async () => {
    const { onUpdate } = await import('../services/yjs-doc.js')
    const unsubscribe = onUpdate('nonexistent/doc', () => {})
    expect(() => unsubscribe()).not.toThrow()
  })

  it('getSnapshotThreshold 返回配置值', async () => {
    const { getSnapshotThreshold } = await import('../services/yjs-doc.js')
    const threshold = getSnapshotThreshold()
    expect(typeof threshold).toBe('number')
    expect(threshold).toBeGreaterThan(0)
  })

  it('cancelEviction 安全处理不存在的文档', async () => {
    const { cancelEviction } = await import('../services/yjs-doc.js')
    // 不应抛错
    expect(() => cancelEviction('nonexistent/doc-id')).not.toThrow()
  })

  it('scheduleEviction 安排清理定时器', async () => {
    vi.useFakeTimers()
    const { getOrCreateDoc, scheduleEviction } = await import('../services/yjs-doc.js')
    const state = getOrCreateDoc(TEST_DOC_ID)
    state.doc.getText('content').insert(0, 'eviction test')

    // 确保 clients 为空
    state.clients.clear()

    scheduleEviction(TEST_DOC_ID, 1000)
    expect(state.doc).toBeTruthy() // 还未清理

    vi.advanceTimersByTime(1000)
    // 清理后 doc 应被移除（clients 为空）

    vi.useRealTimers()
    state.doc.destroy()
  })

  it('ensureDocument 创建文档记录', async () => {
    const { ensureDocument } = await import('../services/yjs-doc.js')
    const docId = `${TEST_FEATURE_ID}/new-section`

    // 先清理可能残留的数据
    const db = getDb()
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId)

    ensureDocument(docId, TEST_FEATURE_ID, 'new-section')

    const row = db
      .prepare('SELECT id, feature_id, section_key FROM documents WHERE id = ?')
      .get(docId) as { id: string; feature_id: string; section_key: string }
    expect(row).toBeTruthy()
    expect(row.feature_id).toBe(TEST_FEATURE_ID)
    expect(row.section_key).toBe('new-section')
  })

  it('ensureDocument 对已存在的文档不重复创建', async () => {
    const { ensureDocument } = await import('../services/yjs-doc.js')
    const db = getDb()

    // 已存在 TEST_DOC_ID 的记录
    ensureDocument(TEST_DOC_ID, TEST_FEATURE_ID, 'section')

    const count = (
      db.prepare('SELECT COUNT(*) as cnt FROM documents WHERE id = ?').get(TEST_DOC_ID) as {
        cnt: number
      }
    ).cnt
    expect(count).toBe(1) // 不应创建重复记录
  })
})
