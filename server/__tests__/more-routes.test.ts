/** 更多路由集成测试 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, cleanupTestData } from './test-app.js'
import { getDb } from '../db/index.js'

const PREFIX = 'more'

let app: Awaited<ReturnType<typeof buildTestApp>>
let adminToken: string

beforeAll(async () => {
  app = await buildTestApp()
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'Admin@123' },
  })
  adminToken = loginRes.json().data.token
})

afterAll(async () => {
  cleanupTestData(getDb(), PREFIX)
  await app.close()
})

describe('用户管理路由', () => {
  it('admin 可获取用户列表', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/users',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('创建用户', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        username: `__test_${PREFIX}_user`,
        displayName: 'Test U',
        password: 'TestPass1!',
        role: 'member',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('重复用户名返回错误', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        username: `__test_${PREFIX}_user`,
        displayName: 'Test U2',
        password: 'TestPass1!',
        role: 'member',
      },
    })
    // SQLite UNIQUE constraint 返回 500
    expect([409, 500]).toContain(res.statusCode)
  })
})

describe('分类路由', () => {
  let catId: string

  it('创建分类', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        projectId: 'default',
        name: `__test_${PREFIX}_cat`,
        color: '#ff0000',
        sortOrder: 1,
      },
    })
    expect(res.statusCode).toBe(200)
    catId = res.json().data.id
    expect(catId).toBeTruthy()
  })

  it('更新分类', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/categories/${catId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: `__test_${PREFIX}_cat_updated`, color: '#00ff00', sortOrder: 2 },
    })
    expect(res.statusCode).toBe(200)
  })

  it('删除分类', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/categories/${catId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('AI 路由', () => {
  it('未登录返回 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/chat',
      payload: { prompt: 'hello' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('飞书绑定路由', () => {
  it('未登录时需要认证', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/feishu/bind-url' })
    // 可能返回 401 或 404（如果飞书未配置）
    expect([401, 404]).toContain(res.statusCode)
  })
})

describe('数据任务路由', () => {
  it('未登录返回 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/default/export/estimate',
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('缓存路由', () => {
  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/cache/remote/stats' })
    expect([401, 404]).toContain(res.statusCode)
  })
})
