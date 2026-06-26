import { describe, it, expect } from 'vitest'
import { signToken, verifyToken } from '../auth/jwt.js'

// 设置 JWT_SECRET 环境变量
process.env.JWT_SECRET = 'test-secret-for-unit-tests'

const testPayload = {
  userId: 'user-001',
  username: 'testuser',
  displayName: 'Test User',
  role: 'member' as const,
  tokenVersion: 0,
}

describe('JWT sign/verify', () => {
  it('应签发并校验有效 token', () => {
    const token = signToken(testPayload)
    expect(token).toBeTruthy()
    expect(typeof token).toBe('string')

    const decoded = verifyToken(token)
    expect(decoded.userId).toBe('user-001')
    expect(decoded.username).toBe('testuser')
    expect(decoded.role).toBe('member')
    expect(decoded.tokenVersion).toBe(0)
  })

  it('应拒绝无效 token', () => {
    expect(() => verifyToken('invalid.token.here')).toThrow()
    expect(() => verifyToken('')).toThrow()
  })

  it('token 应包含 exp 过期时间（7天）', () => {
    const token = signToken(testPayload)
    const decoded = verifyToken(token)
    expect(decoded.exp).toBeDefined()
    const now = Math.floor(Date.now() / 1000)
    expect(decoded.exp).toBeGreaterThan(now)
    // 7天 + 10s 容差
    expect(decoded.exp).toBeLessThan(now + 7 * 86400 + 10)
  })

  it('不同 payload 应产生不同 token', () => {
    const token1 = signToken({ ...testPayload, userId: 'a' })
    const token2 = signToken({ ...testPayload, userId: 'b' })
    expect(token1).not.toBe(token2)
  })
})
