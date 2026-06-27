/** Catalog 集成测试：CRUD + 发布 + 预览 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, cleanupTestData } from './test-app.js'
import { getDb } from '../db/index.js'

const PREFIX = 'cat'

let app: Awaited<ReturnType<typeof buildTestApp>>
let adminToken: string
let memberToken: string
let projectId: string
let catalogId: string

beforeAll(async () => {
  app = await buildTestApp()
  // admin 登录
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  })
  adminToken = loginRes.json().data.token

  // 创建测试项目和成员
  const projRes = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: `__test_${PREFIX}_proj`, description: 'test' },
  })
  projectId = projRes.json().data.id

  // 创建普通用户
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      username: `__test_${PREFIX}_mbr`,
      displayName: 'M',
      password: 'TestPass1!',
      role: 'member',
    },
  })
  const memberLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: `__test_${PREFIX}_mbr`, password: 'TestPass1!' },
  })
  memberToken = memberLogin.json().data.token
})

afterAll(async () => {
  cleanupTestData(getDb(), PREFIX)
  await app.close()
})

describe('Catalog CRUD', () => {
  it('可创建 catalog', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/catalogs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: '__test_cat_temp', features: [], targets: [], projectId },
    })
    expect(res.statusCode).toBe(200)
    catalogId = res.json().data.id
    expect(catalogId).toBeTruthy()
  })

  it('可按项目过滤 catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/catalogs?projectId=${projectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('非成员不可访问', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/catalogs/${catalogId}/preview`,
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect([404, 403]).toContain(res.statusCode)
  })

  it('404 不存在的 catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/catalogs/nonexistent-id/preview',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('Catalog 预览', () => {
  it('返回预览数据', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/catalogs/${catalogId}/preview`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.catalog).toBeTruthy()
    expect(data.catalog.title).toBe('__test_cat_temp')
  })

  it('预览模式可指定 approved', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/catalogs/${catalogId}/preview?mode=approved`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('Catalog 版本', () => {
  it('未发布时返回空版本列表', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/catalogs/${catalogId}/versions`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })
})
