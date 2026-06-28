/** 简单 GET 路由集成测试 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, cleanupTestData } from './test-app.js'
import { getDb } from '../db/index.js'

const PREFIX = 'simple'

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

describe('搜索路由', () => {
  it('空查询返回空结果', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=&projectId=default',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.results).toEqual([])
  })

  it('缺少 projectId 返回 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=test',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('未登录返回 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=test&projectId=default',
    })
    expect(res.statusCode).toBe(401)
  })

  it('重建索引需要 admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/search/rebuild',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { projectId: 'default' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('待办路由', () => {
  it('获取所有待办', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/todos',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('按项目过滤待办', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/todos?projectId=default',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/todos' })
    expect(res.statusCode).toBe(401)
  })
})

describe('个人资料路由', () => {
  it('获取当前用户资料', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.ok).toBe(true)
  })

  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' })
    expect(res.statusCode).toBe(401)
  })
})

describe('审计日志路由', () => {
  it('获取审计日志（空，需 admin）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs' })
    expect(res.statusCode).toBe(401)
  })
})

describe('前端日志路由', () => {
  it('记录前端日志', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/log/frontend',
      payload: { message: 'test error', stack: 'Error: test' },
    })
    expect([200, 204]).toContain(res.statusCode)
  })
})
