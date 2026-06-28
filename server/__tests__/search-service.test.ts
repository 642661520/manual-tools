import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDb } from '../db/index.js'
import {
  indexDocument,
  removeDocument,
  searchDocs,
  rebuildProjectIndex,
} from '../services/search.js'

const TEST_PROJECT = '__test_search_proj'
const TEST_DOC_A = '__test_search/doc-a'
const TEST_DOC_B = '__test_search/doc-b'

beforeAll(() => {
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO projects (id, name, description) VALUES (?, ?, ?)').run(
    TEST_PROJECT,
    TEST_PROJECT,
    'test',
  )
  db.prepare(
    'INSERT OR IGNORE INTO features (id, title, description, sections, is_custom, project_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('__test_search', 'SearchTest', '', '[]', 0, TEST_PROJECT)
})

afterAll(() => {
  const db = getDb()
  db.prepare('DELETE FROM search_docs WHERE project_id = ?').run(TEST_PROJECT)
  db.prepare('DELETE FROM features WHERE id = ?').run('__test_search')
  db.prepare('DELETE FROM projects WHERE id = ?').run(TEST_PROJECT)
})

describe('indexDocument', () => {
  it('创建搜索索引', () => {
    indexDocument(TEST_DOC_A, TEST_PROJECT, '测试文档', '<p>这是测试内容</p>')
    const db = getDb()
    const row = db.prepare('SELECT * FROM search_docs WHERE doc_id = ?').get(TEST_DOC_A) as
      | { doc_id: string; title: string; project_id: string }
      | undefined
    expect(row).toBeTruthy()
    expect(row!.title).toBe('测试文档')
    expect(row!.project_id).toBe(TEST_PROJECT)
  })

  it('空内容时删除索引', () => {
    indexDocument(TEST_DOC_A, TEST_PROJECT, '空文档', '')
    const db = getDb()
    const row = db.prepare('SELECT * FROM search_docs WHERE doc_id = ?').get(TEST_DOC_A)
    expect(row).toBeUndefined()
  })
})

describe('removeDocument', () => {
  it('删除搜索索引', () => {
    indexDocument(TEST_DOC_B, TEST_PROJECT, '待删除', '<p>content</p>')
    removeDocument(TEST_DOC_B)
    const db = getDb()
    const row = db.prepare('SELECT * FROM search_docs WHERE doc_id = ?').get(TEST_DOC_B)
    expect(row).toBeUndefined()
  })
})

describe('searchDocs', () => {
  beforeAll(() => {
    indexDocument(TEST_DOC_A, TEST_PROJECT, '操作手册编写指南', '<p>如何使用平台编写操作手册</p>')
  })

  it('搜索匹配内容', () => {
    const results = searchDocs('操作手册', TEST_PROJECT)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toBe('操作手册编写指南')
  })

  it('无匹配时返回空数组', () => {
    const results = searchDocs('不存在的关键字xyz', TEST_PROJECT)
    expect(results).toEqual([])
  })

  it('空查询返回空数组', () => {
    expect(searchDocs('', TEST_PROJECT)).toEqual([])
    expect(searchDocs('  ', TEST_PROJECT)).toEqual([])
  })

  it('不同项目隔离', () => {
    const results = searchDocs('操作手册', 'other-project')
    expect(results).toEqual([])
  })
})

describe('rebuildProjectIndex', () => {
  it('重建索引不抛错', () => {
    expect(() => rebuildProjectIndex(TEST_PROJECT)).not.toThrow()
  })
})
