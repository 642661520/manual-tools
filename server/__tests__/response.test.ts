import { describe, it, expect } from 'vitest'
import { success, fail, ok, created } from '../lib/response.js'

// Mock Fastify reply 对象（仅 fail 需要）
function mockReply() {
  const state = { statusCode: 200, body: '' }
  const reply = {
    get statusCode() {
      return state.statusCode
    },
    get body() {
      return state.body
    },
    status(code: number) {
      state.statusCode = code
      return reply
    },
    send(data: unknown) {
      state.body = JSON.stringify(data)
      return reply
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return reply as any
}

describe('response helpers', () => {
  describe('success', () => {
    it('应返回 ok: true + data', () => {
      const result = success({ name: 'test' })
      expect(result).toEqual({ ok: true, data: { name: 'test' } })
    })

    it('应支持无 data 调用', () => {
      const result = success(undefined)
      expect(result).toEqual({ ok: true, data: undefined })
    })
  })

  describe('fail', () => {
    it('应返回指定状态码 + ok: false + error', () => {
      const reply = mockReply()
      fail(reply as never, 400, '用户名不能为空')
      expect(reply.statusCode).toBe(400)
      const result = JSON.parse(reply.body)
      expect(result).toEqual({ ok: false, error: '用户名不能为空' })
    })
  })

  describe('ok', () => {
    it('应返回 ok: true', () => {
      expect(ok()).toEqual({ ok: true })
    })
  })

  describe('created', () => {
    it('应返回 ok: true + data.id', () => {
      expect(created('id-001')).toEqual({ ok: true, data: { id: 'id-001' } })
    })
  })
})
