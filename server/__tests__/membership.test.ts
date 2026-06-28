/**
 * 直接测试 membership 工具函数（不走 HTTP）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDb } from '../db/index.js'
import { isProjectMember, hasProjectRole, isExplicitMember, assertCatalogMember } from '../auth/membership.js'

const TEST_USER_ID = '__test_mbr_user'
const TEST_PROJECT_ID = '__test_mbr_proj'
const TEST_CATALOG_ID = '__test_mbr_cat'

beforeAll(() => {
  const db = getDb()
  // 创建测试用户
  db.prepare(
    'INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
  ).run(TEST_USER_ID, TEST_USER_ID, 'Test Member', 'hash', 'member')
  // 创建测试项目
  db.prepare(
    'INSERT OR IGNORE INTO projects (id, name, description) VALUES (?, ?, ?)',
  ).run(TEST_PROJECT_ID, TEST_PROJECT_ID, 'test')
  // 添加为项目成员 (writer 角色)
  db.prepare(
    'INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
  ).run(TEST_PROJECT_ID, TEST_USER_ID, 'writer')
  // 创建测试 catalog
  db.prepare(
    'INSERT OR IGNORE INTO catalogs (id, title, targets, features, cover_info, project_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(TEST_CATALOG_ID, TEST_CATALOG_ID, '[]', '[]', '{}', TEST_PROJECT_ID)
})

afterAll(() => {
  const db = getDb()
  db.prepare('DELETE FROM catalog_versions WHERE catalog_id = ?').run(TEST_CATALOG_ID)
  db.prepare('DELETE FROM catalogs WHERE id = ?').run(TEST_CATALOG_ID)
  db.prepare('DELETE FROM project_members WHERE project_id = ?').run(TEST_PROJECT_ID)
  db.prepare('DELETE FROM projects WHERE id = ?').run(TEST_PROJECT_ID)
  db.prepare('DELETE FROM users WHERE id = ?').run(TEST_USER_ID)
})

describe('isProjectMember', () => {
  it('admin 角色直接通过', () => {
    expect(isProjectMember('any-user', 'admin', 'any-project')).toBe(true)
  })

  it('项目成员返回 true', () => {
    expect(isProjectMember(TEST_USER_ID, 'member', TEST_PROJECT_ID)).toBe(true)
  })

  it('非项目成员返回 false', () => {
    expect(isProjectMember('non-existent', 'member', TEST_PROJECT_ID)).toBe(false)
  })

  it('不存在的项目返回 false', () => {
    expect(isProjectMember(TEST_USER_ID, 'member', 'non-existent-project')).toBe(false)
  })
})

describe('hasProjectRole', () => {
  it('admin 自动满足所有项目角色', () => {
    expect(hasProjectRole('any-user', 'admin', 'any-project', 'pm')).toBe(true)
  })

  it('writer 角色满足 viewer 要求', () => {
    expect(hasProjectRole(TEST_USER_ID, 'member', TEST_PROJECT_ID, 'viewer')).toBe(true)
  })

  it('writer 角色满足 writer 要求', () => {
    expect(hasProjectRole(TEST_USER_ID, 'member', TEST_PROJECT_ID, 'writer')).toBe(true)
  })

  it('writer 角色不满足 pm 要求', () => {
    expect(hasProjectRole(TEST_USER_ID, 'member', TEST_PROJECT_ID, 'pm')).toBe(false)
  })

  it('非项目成员不满足任何角色', () => {
    expect(hasProjectRole('non-existent', 'member', TEST_PROJECT_ID, 'viewer')).toBe(false)
  })
})

describe('isExplicitMember', () => {
  it('admin 直接通过', () => {
    expect(isExplicitMember('any-user', 'admin', 'any-project')).toBe(true)
  })

  it('显式成员返回 true', () => {
    expect(isExplicitMember(TEST_USER_ID, 'member', TEST_PROJECT_ID)).toBe(true)
  })

  it('非显式成员返回 false', () => {
    expect(isExplicitMember('non-existent', 'member', TEST_PROJECT_ID)).toBe(false)
  })
})

describe('assertCatalogMember', () => {
  it('admin 角色返回 catalog 所属项目 ID', () => {
    const db = getDb()
    const result = assertCatalogMember(db, TEST_CATALOG_ID, 'admin-user', 'admin')
    expect(result).toEqual({ projectId: TEST_PROJECT_ID })
  })

  it('项目成员返回项目 ID', () => {
    const db = getDb()
    const result = assertCatalogMember(db, TEST_CATALOG_ID, TEST_USER_ID, 'member')
    expect(result).toEqual({ projectId: TEST_PROJECT_ID })
  })

  it('非成员返回 null', () => {
    const db = getDb()
    const result = assertCatalogMember(db, TEST_CATALOG_ID, 'non-existent', 'member')
    expect(result).toBeNull()
  })

  it('不存在的 catalog 返回 null', () => {
    const db = getDb()
    const result = assertCatalogMember(db, 'non-existent-catalog', TEST_USER_ID, 'member')
    expect(result).toBeNull()
  })
})
