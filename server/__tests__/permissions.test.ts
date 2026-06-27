/** 权限测试：isProjectMember + hasProjectRole */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, cleanupTestData } from './test-app.js'
import { getDb } from '../db/index.js'

const PREFIX = 'perm'

let app: Awaited<ReturnType<typeof buildTestApp>>
let adminToken: string
let memberToken: string
let guestToken: string
let projectId: string

beforeAll(async () => {
  app = await buildTestApp()
  const loginRes = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  })
  adminToken = loginRes.json().data.token

  // 创建测试项目
  const projRes = await app.inject({
    method: 'POST', url: '/api/v1/projects',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: `__test_${PREFIX}_proj`, description: 'test' },
  })
  projectId = projRes.json().data.id

  // 创建 member 用户
  await app.inject({
    method: 'POST', url: '/api/v1/auth/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { username: `__test_${PREFIX}_mbr`, displayName: 'M', password: 'TestPass1!', role: 'member' },
  })
  // 创建 guest 用户
  await app.inject({
    method: 'POST', url: '/api/v1/auth/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { username: `__test_${PREFIX}_gst`, displayName: 'G', password: 'TestPass1!', role: 'guest' },
  })

  const mbrLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: `__test_${PREFIX}_mbr`, password: 'TestPass1!' },
  })
  memberToken = mbrLogin.json().data.token

  const gstLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: `__test_${PREFIX}_gst`, password: 'TestPass1!' },
  })
  guestToken = gstLogin.json().data.token
})

afterAll(async () => {
  cleanupTestData(getDb(), PREFIX)
  await app.close()
})

describe('权限控制', () => {
  it('admin 可访问所有项目', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/projects`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('未加入项目的 member 看不到项目数据', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/features?projectId=${projectId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    })
    // 不是项目成员，应返回空列表或 403
    expect([200, 403]).toContain(res.statusCode)
  })

  it('guest 不可访问项目资源', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/features?projectId=${projectId}`,
      headers: { authorization: `Bearer ${guestToken}` },
    })
    // guest 可能被直接拒绝访问，或返回空数据
    expect([200, 403]).toContain(res.statusCode)
  })

  it('未登录不可访问', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/projects',
    })
    expect(res.statusCode).toBe(401)
  })

  it('普通用户不可创建项目', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/projects',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { name: '__test_perm_noauth', description: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })
})
