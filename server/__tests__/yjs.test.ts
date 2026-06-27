/** Yjs 文档测试：快照创建与恢复 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { getDb } from '../db/index.js'

const TEST_FEATURE_ID = '__test_yjs_feat'
const TEST_DOC_ID = `${TEST_FEATURE_ID}/section`

beforeAll(async () => {
  const db = getDb()
  db.prepare(
    'INSERT OR IGNORE INTO features (id, title, description, sections, is_custom, project_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(TEST_FEATURE_ID, 'Test Feature', '', '[]', 0, 'default')
})

afterEach(() => {
  // 每个测试后清理残留数据
  const db = getDb()
  db.prepare('DELETE FROM document_snapshots WHERE document_id = ?').run(TEST_DOC_ID)
  db.prepare('DELETE FROM document_updates WHERE document_id = ?').run(TEST_DOC_ID)
  db.prepare('DELETE FROM documents WHERE id = ?').run(TEST_DOC_ID)
  // 重新创建干净的 document 记录给下一个测试
  db.prepare(
    'INSERT OR IGNORE INTO documents (id, feature_id, section_key, status) VALUES (?, ?, ?, ?)',
  ).run(TEST_DOC_ID, TEST_FEATURE_ID, 'section', 'draft')
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
})
