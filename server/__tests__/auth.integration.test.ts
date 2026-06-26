/**
 * 认证集成测试：登录、创建用户
 * 直接在现有数据库上操作，使用 __test_ 前缀标识测试数据
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, cleanupTestData } from './test-app.js'
import { getDb } from '../db/index.js'

const TEST_PREFIX = 'auth_int'

let app: Awaited<ReturnType<typeof buildTestApp>>

beforeAll(async () => {
  app = await buildTestApp()
})

afterAll(async () => {
  cleanupTestData(getDb(), TEST_PREFIX)
  await app.close()
})

describe('Auth 集成测试', () => {
  const testUser = {
    username: `__test_${TEST_PREFIX}_writer`,
    displayName: '测试写手',
    password: 'TestPass1!',
    role: 'member',
  }

  it('admin 可创建新用户', async () => {
    // 先用 admin 登录获取 token
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    })
    expect(loginRes.statusCode).toBe(200)
    const loginBody = loginRes.json()
    expect(loginBody.ok).toBe(true)
    const adminToken = loginBody.data.token

    // 创建测试用户
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: testUser,
    })
    expect(createRes.statusCode).toBe(200)
  })

  it('新用户可用正确密码登录', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: testUser.username, password: testUser.password },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.data.user.username).toBe(testUser.username)
    expect(body.data.token).toBeTruthy()
  })

  it('错误密码应返回 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: testUser.username, password: 'WrongPass1!' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().ok).toBe(false)
  })

  it('不存在的用户应返回 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: '__test_nonexistent', password: 'Anything1!' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('空用户名或密码应返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: '', password: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('ops 用户不可创建用户', async () => {
    // 用刚创建的 ops 用户登录
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: testUser.username, password: testUser.password },
    })
    const opsToken = loginRes.json().data.token

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/users',
      headers: { authorization: `Bearer ${opsToken}` },
      payload: {
        username: `__test_${TEST_PREFIX}_noperm`,
        displayName: 'NoPerm',
        password: 'TestPass1!',
        role: 'member',
      },
    })
    expect(createRes.statusCode).toBe(403)
  })
})
