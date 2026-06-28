import { describe, it, expect } from 'vitest'
import { ensureProjectWritable, requireRole } from '../auth/middleware.js'
import type { FastifyRequest, FastifyReply } from 'fastify'

// ---- Mock 辅助 ----

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

function mockReq(user?: { role: string }) {
  return { user } as unknown as FastifyRequest
}

// ---- 测试 ----

describe('ensureProjectWritable', () => {
  it('非 default 项目允许写入', () => {
    const { reply, getStatusCode } = mockReply()
    const result = ensureProjectWritable('other-project', reply)
    expect(result).toBe(true)
    expect(getStatusCode()).toBe(200)
  })

  it('defaultProjectReadonly 未开启时允许写入 default 项目', () => {
    // 默认情况下环境变量未设置，defaultProjectReadonly = false
    const { reply, getStatusCode } = mockReply()
    const result = ensureProjectWritable('default', reply)
    expect(result).toBe(true)
    expect(getStatusCode()).toBe(200)
  })
})

describe('requireRole', () => {
  it('用户未登录返回 401', async () => {
    const { reply, getStatusCode, getBody } = mockReply()
    const handler = requireRole('admin')
    await handler(mockReq(undefined), reply)
    expect(getStatusCode()).toBe(401)
    expect(getBody()).toEqual({ ok: false, error: '未登录' })
  })

  it('用户角色不在允许列表中返回 403', async () => {
    const { reply, getStatusCode, getBody } = mockReply()
    const handler = requireRole('admin')
    await handler(mockReq({ role: 'member' }), reply)
    expect(getStatusCode()).toBe(403)
    expect(getBody()).toEqual({ ok: false, error: '权限不足' })
  })

  it('用户角色在允许列表中放行', async () => {
    const { reply, getStatusCode } = mockReply()
    const handler = requireRole('admin', 'pm')
    await handler(mockReq({ role: 'pm' }), reply)
    expect(getStatusCode()).toBe(200)
  })

  it('admin 角色通过 admin 要求', async () => {
    const { reply, getStatusCode } = mockReply()
    const handler = requireRole('admin')
    await handler(mockReq({ role: 'admin' }), reply)
    expect(getStatusCode()).toBe(200)
  })

  it('单个角色要求也支持', async () => {
    const { reply, getStatusCode } = mockReply()
    const handler = requireRole('viewer')
    await handler(mockReq({ role: 'viewer' }), reply)
    expect(getStatusCode()).toBe(200)
  })
})
