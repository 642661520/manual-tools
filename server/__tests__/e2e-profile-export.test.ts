import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, cleanupTestData } from './test-app.js'
import { getDb } from '../db/index.js'

const PREFIX = 'zprof'

let app: Awaited<ReturnType<typeof buildTestApp>>
let adminToken: string
let memberToken: string
let memberId: string

beforeAll(async () => {
  app = await buildTestApp()
  const loginRes = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  })
  adminToken = loginRes.json().data.token

  const mbrRes = await app.inject({
    method: 'POST', url: '/api/v1/auth/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      username: `__test_${PREFIX}_m`, displayName: 'ProfileTester',
      password: 'Profile99!', role: 'member',
    },
  })
  const mbrLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username: `__test_${PREFIX}_m`, password: 'Profile99!' },
  })
  memberToken = mbrLogin.json().data.token
  memberId = mbrLogin.json().data.user.id
})

afterAll(async () => {
  cleanupTestData(getDb(), PREFIX)
  await app.close()
})

describe('E2E: 用户个人资料', () => {
  it('获取当前用户信息', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const user = res.json().data.user
    expect(user.username).toBe('admin')
    expect(user.role).toBe('admin')
  })

  it('更新显示名称', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { displayName: 'Updated Name' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('修改密码', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/v1/auth/me/password',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { currentPassword: 'Profile99!', newPassword: 'NewPass99!' },
    })
    expect([200, 400]).toContain(res.statusCode)
  })
})

describe('E2E: 导出预估 + 搜索', () => {
  it('预估导出大小', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/projects/default/export/estimate',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('全文搜索（含内容）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/search?q=admin&projectId=default',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('E2E: 用户管理（admin）', () => {
  it('查看用户列表', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/auth/users',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('删除测试用户', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/api/v1/auth/users/${memberId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})
