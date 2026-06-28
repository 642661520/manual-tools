import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDb } from '../db/index.js'
import { signToken } from '../auth/jwt.js'
import { authMiddleware } from '../auth/middleware.js'
import type { FastifyRequest, FastifyReply } from 'fastify'

function mockReply() {
  let statusCode = 200
  let body: unknown = null
  const reply = {
    status(code: number) {
      statusCode = code
      return reply
    },
    send(data: unknown) {
      body = data
      return reply
    },
  }
  return { reply: reply as unknown as FastifyReply, statusCode: () => statusCode, body: () => body }
}

function mockReq(opts: { token?: string }) {
  const headers: Record<string, string | string[] | undefined> = {}
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`
  return { headers } as unknown as FastifyRequest
}

const TEST_USER_ID = '__test_mw_user'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-middleware-secret-32bytes!'
  const db = getDb()
  db.prepare(
    'INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, token_version) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(TEST_USER_ID, TEST_USER_ID, 'MW Tester', 'hash', 'member', 42)
})

afterAll(() => {
  const db = getDb()
  db.prepare('DELETE FROM users WHERE id = ?').run(TEST_USER_ID)
})

describe('authMiddleware', () => {
  it('无 token 返回 401', async () => {
    const { reply, statusCode, body } = mockReply()
    await authMiddleware(mockReq({}), reply)
    expect(statusCode()).toBe(401)
    expect(body()).toEqual({ ok: false, error: '未登录' })
  })

  it('Token 过期/无效返回 401', async () => {
    const { reply, statusCode, body } = mockReply()
    await authMiddleware(mockReq({ token: 'invalid.token.here' }), reply)
    expect(statusCode()).toBe(401)
    expect(body()).toEqual({ ok: false, error: '登录已过期，请重新登录' })
  })

  it('用户不存在返回 401', async () => {
    const token = signToken({
      userId: 'nonexistent-user-999',
      username: 'ghost',
      displayName: 'Ghost',
      role: 'member',
      tokenVersion: 0,
    })
    const { reply, statusCode, body } = mockReply()
    await authMiddleware(mockReq({ token }), reply)
    expect(statusCode()).toBe(401)
    expect(body()).toEqual({ ok: false, error: '用户不存在' })
  })

  it('Token 版本不匹配返回 401', async () => {
    // 用户 token_version=42，签发一个 version=0 的 token
    const token = signToken({
      userId: TEST_USER_ID,
      username: TEST_USER_ID,
      displayName: 'MW Tester',
      role: 'member',
      tokenVersion: 0,
    })
    const { reply, statusCode, body } = mockReply()
    await authMiddleware(mockReq({ token }), reply)
    expect(statusCode()).toBe(401)
    expect(body()).toEqual({ ok: false, error: '登录已失效，请重新登录' })
  })

  it('有效 token 放行', async () => {
    const token = signToken({
      userId: TEST_USER_ID,
      username: TEST_USER_ID,
      displayName: 'MW Tester',
      role: 'member',
      tokenVersion: 42,
    })
    const { reply, statusCode } = mockReply()
    await authMiddleware(mockReq({ token }), reply)
    expect(statusCode()).toBe(200)
  })
})
