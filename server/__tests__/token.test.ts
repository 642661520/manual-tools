import { describe, it, expect } from 'vitest'
import { extractToken, extractTokenFromFastify } from '../auth/token.js'

describe('extractToken', () => {
  it('从 Authorization Bearer header 提取 token', () => {
    const req = { headers: { authorization: 'Bearer my-jwt-token-123' } }
    expect(extractToken(req)).toBe('my-jwt-token-123')
  })

  it('从 Cookie 中提取 auth_token', () => {
    const req = { headers: { cookie: 'auth_token=cookie-jwt-token; other=value' } }
    expect(extractToken(req)).toBe('cookie-jwt-token')
  })

  it('Cookie 在开头时也能提取', () => {
    const req = { headers: { cookie: 'auth_token=start-token' } }
    expect(extractToken(req)).toBe('start-token')
  })

  it('Bearer 优先于 Cookie', () => {
    const req = {
      headers: {
        authorization: 'Bearer header-token',
        cookie: 'auth_token=cookie-token',
      },
    }
    expect(extractToken(req)).toBe('header-token')
  })

  it('Authorization 不是 Bearer 格式时回退到 Cookie', () => {
    const req = {
      headers: {
        authorization: 'Basic xyz',
        cookie: 'auth_token=fallback-token',
      },
    }
    expect(extractToken(req)).toBe('fallback-token')
  })

  it('无 Authorization 也无 auth_token cookie 时返回 null', () => {
    expect(extractToken({ headers: {} })).toBeNull()
    expect(extractToken({ headers: { cookie: 'other=value' } })).toBeNull()
    expect(extractToken({ headers: { authorization: 'NoBearer xyz' } })).toBeNull()
  })

  it('Authorization 为空字符串时回退到 Cookie', () => {
    const req = {
      headers: {
        authorization: '',
        cookie: 'auth_token=cookie-only',
      },
    }
    expect(extractToken(req)).toBe('cookie-only')
  })

  it('Cookie 中 auth_token 值包含特殊字符', () => {
    const req = {
      headers: {
        cookie: 'auth_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      },
    }
    // JWT 格式的 token，分号会截断
    expect(extractToken(req)).toBe(
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    )
  })

  it('headers 值为 undefined 时返回 null', () => {
    const req = { headers: { authorization: undefined, cookie: undefined } }
    expect(extractToken(req)).toBeNull()
  })
})

describe('extractTokenFromFastify', () => {
  it('委托给 extractToken，从 Bearer header 提取', () => {
    const req = { headers: { authorization: 'Bearer fastify-token' } }
    expect(extractTokenFromFastify(req)).toBe('fastify-token')
  })

  it('无 token 时返回 null', () => {
    const req = { headers: {} }
    expect(extractTokenFromFastify(req)).toBeNull()
  })
})
