/**
 * 端到端业务流程测试
 * 覆盖：项目管理 → 文档编写 → 人员协作 → 目录发布 完整链路
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, cleanupTestData } from './test-app.js'
import { getDb } from '../db/index.js'

const PREFIX = 'e2e'

let app: Awaited<ReturnType<typeof buildTestApp>>
let adminToken: string
let memberToken: string
let memberId: string
let projectId: string
let categoryId: string
let featureId: string
let catalogId: string

beforeAll(async () => {
  app = await buildTestApp()

  // 1. Admin 登录
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'Admin@123' },
  })
  adminToken = loginRes.json().data.token
  expect(loginRes.statusCode).toBe(200)

  // 2. 创建成员用户
  const createUserRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      username: `__test_${PREFIX}_writer`,
      displayName: 'E2E Writer',
      password: 'WriterPass1!',
      role: 'member',
    },
  })
  expect(createUserRes.statusCode).toBe(200)

  // 3. 成员登录
  const memberLoginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: `__test_${PREFIX}_writer`, password: 'WriterPass1!' },
  })
  memberToken = memberLoginRes.json().data.token
  memberId = memberLoginRes.json().data.user.id
  expect(memberLoginRes.statusCode).toBe(200)
})

afterAll(async () => {
  cleanupTestData(getDb(), PREFIX)
  await app.close()
})

// ============================================================
// 流程 1: 项目管理完整生命周期
// ============================================================
describe('流程1: 项目管理', () => {
  it('1.1 创建项目', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: `__test_${PREFIX}_proj`, description: 'E2E 测试项目' },
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.ok).toBe(true)
    expect(data.data.id).toBeTruthy()
    projectId = data.data.id
  })

  it('1.2 获取项目列表', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const projects = res.json().data
    expect(Array.isArray(projects)).toBe(true)
    expect(projects.some((p: { id: string }) => p.id === projectId)).toBe(true)
  })

  it('1.3 获取项目详情', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toContain(PREFIX)
  })

  it('1.4 更新项目信息', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: `__test_${PREFIX}_proj_updated`, description: '更新后的描述' },
    })
    expect(res.statusCode).toBe(200)
    // 验证更新生效
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(getRes.json().data.name).toContain('updated')
  })
})

// ============================================================
// 流程 2: 成员协作
// ============================================================
describe('流程2: 成员协作', () => {
  it('2.1 添加成员到项目', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { userId: memberId, projectRole: 'writer' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('2.2 查看项目成员列表', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const members = res.json().data
    expect(members.some((m: { id: string }) => m.id === memberId)).toBe(true)
  })

  it('2.3 更改成员角色（重复 POST 更新角色）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { userId: memberId, projectRole: 'pm' },
    })
    expect(res.statusCode).toBe(200)

    // 验证角色变更
    const membersRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(membersRes.statusCode).toBe(200)
    const rawData = membersRes.json().data
    const member = rawData.find((m: { id: string }) => m.id === memberId)
    expect(member).toBeTruthy()
    // 字段名可能是 projectRole 或 role，取决于路由实现
    const roleValue = member.project_role
    expect(roleValue).toBe('pm')
  })

  it('2.4 成员可以访问项目内容', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/features?projectId=${projectId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ============================================================
// 流程 3: 分类 + 功能 + 文档
// ============================================================
describe('流程3: 内容创作', () => {
  it('3.1 创建分类', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { projectId, name: `__test_${PREFIX}_cat`, color: '#6366f1', sortOrder: 1 },
    })
    expect(res.statusCode).toBe(200)
    categoryId = res.json().data.id
    expect(categoryId).toBeTruthy()
  })

  it('3.2 创建功能（关联分类）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/features',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        projectId,
        title: `__test_${PREFIX}_feature`,
        description: 'E2E 测试功能',
        categoryId,
        sections: [
          { key: 'overview', title: '概述', description: '功能概述' },
          { key: 'details', title: '详细说明', description: '详细说明' },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    featureId = res.json().data.id
    expect(featureId).toContain('custom:')
  })

  it('3.3 获取功能详情（含 sections）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/features/${featureId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.title).toContain(PREFIX)
  })

  it('3.4 更新功能信息', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/features/${featureId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: `__test_${PREFIX}_feature_v2`, description: '更新后', categoryId },
    })
    expect(res.statusCode).toBe(200)
  })

  it('3.5 按分类筛选功能', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/features?projectId=${projectId}&categoryId=${categoryId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const features = res.json().data
    expect(features.length).toBeGreaterThan(0)
  })
})

// ============================================================
// 流程 4: 目录编排 + 发布
// ============================================================
describe('流程4: 目录发布', () => {
  it('4.1 创建目录', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/catalogs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        projectId,
        title: `__test_${PREFIX}_catalog`,
        features: [{ featureId, type: 'feature' as const }],
        cover: { description: 'E2E 测试目录' },
      },
    })
    expect(res.statusCode).toBe(200)
    catalogId = res.json().data.id
    expect(catalogId).toBeTruthy()
  })

  it('4.2 获取目录列表', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/catalogs?projectId=${projectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBeGreaterThan(0)
  })

  it('4.3 更新目录（添加更多功能）', async () => {
    // 先创建第二个功能
    const featRes = await app.inject({
      method: 'POST',
      url: '/api/v1/features',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        projectId,
        title: `__test_${PREFIX}_feat2`,
        description: '第二个功能',
        sections: [{ key: 'main', title: '正文' }],
      },
    })
    const feat2Id = featRes.json().data.id

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/catalogs/${catalogId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        title: `__test_${PREFIX}_catalog_v2`,
        features: [
          { featureId, type: 'feature' as const },
          { featureId: feat2Id, type: 'feature' as const },
        ],
        cover: { description: '更新后的目录' },
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('4.4 发布目录版本', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/catalogs/${catalogId}/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        changeNotes: '首次发布',
        visibility: 'project_members',
        approvedOnly: false,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('4.5 查看版本列表', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/catalogs/${catalogId}/versions`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const versions = res.json().data
    expect(versions.length).toBeGreaterThan(0)
    expect(versions[0].version_major).toBeGreaterThanOrEqual(0)
  })

  it('4.6 预览目录', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/catalogs/${catalogId}/preview`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ============================================================
// 流程 5: 资源清理
// ============================================================
describe('流程5: 资源清理', () => {
  it('5.1 移除成员', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/members/${memberId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('5.2 删除目录', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/catalogs/${catalogId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('5.3 删除功能', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/features/${featureId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('5.4 删除分类', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/categories/${categoryId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('5.5 删除项目', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)

    // 验证已删除
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(getRes.statusCode).toBe(404)
  })
})
