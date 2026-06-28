import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDb } from '../db/index.js'
import { recordAudit, queryAuditLogs } from '../services/audit.js'

const TEST_USER = '__test_audit_user'

beforeAll(() => {
  const db = getDb()
  db.prepare(
    'INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
  ).run(TEST_USER, TEST_USER, 'AuditTester', 'hash', 'member')
})

afterAll(() => {
  const db = getDb()
  db.prepare('DELETE FROM audit_log WHERE user_id = ?').run(TEST_USER)
  db.prepare('DELETE FROM users WHERE id = ?').run(TEST_USER)
})

describe('recordAudit', () => {
  it('写入审计日志', () => {
    recordAudit({
      userId: TEST_USER,
      username: TEST_USER,
      action: 'project.create',
      targetType: 'project',
      targetId: 'test-proj-1',
      detail: { name: 'Test Project' },
    })

    const db = getDb()
    const row = db
      .prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(TEST_USER) as { action: string; target_type: string; target_id: string; detail: string } | undefined
    expect(row).toBeTruthy()
    expect(row!.action).toBe('project.create')
    expect(row!.target_type).toBe('project')
    expect(row!.target_id).toBe('test-proj-1')

    const detail = JSON.parse(row!.detail)
    expect(detail.name).toBe('Test Project')
  })

  it('无 detail 字段时写入空字符串', () => {
    recordAudit({
      userId: TEST_USER,
      username: TEST_USER,
      action: 'login',
      targetType: 'auth',
    })

    const db = getDb()
    const row = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'login' AND user_id = ? LIMIT 1")
      .get(TEST_USER) as { detail: string } | undefined
    expect(row!.detail).toBe('')
  })
})

describe('queryAuditLogs', () => {
  beforeAll(() => {
    recordAudit({ userId: TEST_USER, username: TEST_USER, action: 'user.update', targetType: 'user', targetId: 'u1' })
    recordAudit({ userId: TEST_USER, username: TEST_USER, action: 'user.delete', targetType: 'user', targetId: 'u2' })
  })

  it('查询所有日志', () => {
    const result = queryAuditLogs({})
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.total).toBeGreaterThan(0)
  })

  it('按 userId 筛选', () => {
    const result = queryAuditLogs({ userId: TEST_USER })
    expect(result.rows.length).toBeGreaterThan(0)
  })

  it('按 action 筛选', () => {
    const result = queryAuditLogs({ action: 'user.update' })
    const allMatch = result.rows.every((r) => r.action === 'user.update')
    expect(allMatch).toBe(true)
  })

  it('按 targetType 筛选', () => {
    const result = queryAuditLogs({ targetType: 'user' })
    expect(result.rows.length).toBeGreaterThan(0)
  })

  it('分页：limit', () => {
    const result = queryAuditLogs({ limit: 1 })
    expect(result.rows.length).toBe(1)
  })

  it('不存在的用户返回空', () => {
    const result = queryAuditLogs({ userId: 'nonexistent-999' })
    expect(result.rows).toEqual([])
    expect(result.total).toBe(0)
  })
})
