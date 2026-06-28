import { describe, it, expect } from 'vitest'
import { generateCsrfToken, setCsrfCookie, csrfMiddleware } from '../lib/csrf.js'
import type { FastifyRequest, FastifyReply } from 'fastify'

// ---- Mock 辅助 ----

function mockReq(method: string, url: string, opts?: { cookieToken?: string; headerToken?: string }) {
  const headers: Record<string, string | string[] | undefined> = {}
  if (opts?.cookieToken !== undefined) {
    headers['cookie'] = `csrf_token=${opts.cookieToken}`
  }
  if (opts?.headerToken !== undefined) {
    headers['x-csrf-token'] = opts.headerToken
  }
  return {
    method,
    url,
    headers,
  } as unknown as FastifyRequest
}

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
  return {
    reply: reply as unknown as FastifyReply,
    getStatusCode: () => statusCode,
    getBody: () => body,
  }
}

// ---- 测试 ----

describe('generateCsrfToken', () => {
  it('生成 64 字符 hex 字符串', () => {
    const token = generateCsrfToken()
    expect(typeof token).toBe('string')
    expect(token).toHaveLength(64)
    expect(/^[a-f0-9]+$/.test(token)).toBe(true)
  })

  it('每次生成不同值', () => {
    const t1 = generateCsrfToken()
    const t2 = generateCsrfToken()
    expect(t1).not.toBe(t2)
  })
})

describe('setCsrfCookie', () => {
  it('生成正确的 Set-Cookie header 字符串', () => {
    const headers: Record<string, string> = {}
    const reply = {
      header: (name: string, value: string) => {
        headers[name] = value
      },
    } as unknown as FastifyReply

    const token = 'abc123def456'
    setCsrfCookie(reply, token)

    const cookie = headers['Set-Cookie']
    expect(cookie).toContain('csrf_token=abc123def456')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Max-Age=86400')
  })
})

describe('csrfMiddleware', () => {
  it('GET 请求跳过校验', async () => {
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(mockReq('GET', '/api/v1/projects'), reply)
    expect(getStatusCode()).toBe(200) // 未触发 403
  })

  it('HEAD 请求跳过校验', async () => {
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(mockReq('HEAD', '/api/v1/projects'), reply)
    expect(getStatusCode()).toBe(200)
  })

  it('OPTIONS 请求跳过校验', async () => {
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(mockReq('OPTIONS', '/api/v1/projects'), reply)
    expect(getStatusCode()).toBe(200)
  })

  it('登录路径跳过校验', async () => {
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(mockReq('POST', '/api/v1/auth/login'), reply)
    expect(getStatusCode()).toBe(200)
  })

  it('飞书登录路径跳过校验', async () => {
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(mockReq('POST', '/api/v1/auth/feishu/callback'), reply)
    expect(getStatusCode()).toBe(200)
  })

  it('前端日志上报路径跳过校验', async () => {
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(mockReq('POST', '/api/v1/log/frontend'), reply)
    expect(getStatusCode()).toBe(200)
  })

  it('Token 匹配时放行', async () => {
    const token = 'valid-token-123'
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(
      mockReq('POST', '/api/v1/features', { cookieToken: token, headerToken: token }),
      reply,
    )
    expect(getStatusCode()).toBe(200)
  })

  it('Token 不匹配时返回 403', async () => {
    const { reply, getStatusCode, getBody } = mockReply()
    await csrfMiddleware(
      mockReq('POST', '/api/v1/features', {
        cookieToken: 'cookie-token',
        headerToken: 'different-token',
      }),
      reply,
    )
    expect(getStatusCode()).toBe(403)
    expect(getBody()).toEqual({ ok: false, error: 'CSRF 校验失败，请刷新页面后重试' })
  })

  it('缺少 cookie token 时返回 403', async () => {
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(
      mockReq('POST', '/api/v1/features', { headerToken: 'some-token' }),
      reply,
    )
    expect(getStatusCode()).toBe(403)
  })

  it('缺少 header token 时返回 403', async () => {
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(
      mockReq('POST', '/api/v1/features', { cookieToken: 'some-token' }),
      reply,
    )
    expect(getStatusCode()).toBe(403)
  })

  it('header token 为数组时取第一项', async () => {
    const token = 'array-token'
    const req = {
      method: 'POST',
      url: '/api/v1/features',
      headers: {
        cookie: `csrf_token=${token}`,
        'x-csrf-token': [token, 'other'],
      },
    } as unknown as FastifyRequest
    const { reply, getStatusCode } = mockReply()
    await csrfMiddleware(req, reply)
    expect(getStatusCode()).toBe(200)
  })
})
