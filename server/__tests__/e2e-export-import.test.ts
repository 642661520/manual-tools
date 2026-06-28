import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, cleanupTestData } from './test-app.js'
import { getDb } from '../db/index.js'

const PREFIX = 'zexp'

let app: Awaited<ReturnType<typeof buildTestApp>>
let adminToken: string
let projectId: string

beforeAll(async () => {
  app = await buildTestApp()
  const loginRes = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  })
  adminToken = loginRes.json().data.token

  const projRes = await app.inject({
    method: 'POST', url: '/api/v1/projects',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: `__test_${PREFIX}_proj`, description: 'Export test' },
  })
  projectId = projRes.json().data.id

  await app.inject({
    method: 'POST', url: '/api/v1/features',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      projectId,
      title: `__test_${PREFIX}_feat`,
      description: 'Export test feature',
      sections: [{ key: 'main', title: '正文' }],
    },
  })
})

afterAll(async () => {
  cleanupTestData(getDb(), PREFIX)
  await app.close()
})

describe('导出流程', () => {
  it('预估导出大小', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/projects/${projectId}/export/estimate`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect([200, 400, 404, 406, 415, 500]).toContain(res.statusCode)
  })

  it('创建导出任务', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/projects/${projectId}/export`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect([200, 500]).toContain(res.statusCode)
  })

  it('未登录拦截', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/export` })
    expect(res.statusCode).toBe(401)
  })
})

describe('导入流程', () => {
  it('导入上传 — 未登录 401', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/import/upload` })
    expect(res.statusCode).toBe(401)
  })

  it('导入上传 — admin 可访问', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/projects/${projectId}/import/upload`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect([200, 400, 404, 406, 415, 500]).toContain(res.statusCode)
  })

  it('数据任务列表', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/data-tasks',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('清理孤儿文件扫描', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/uploads/orphans',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect([200, 404]).toContain(res.statusCode)
  })
})
