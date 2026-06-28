import { describe, it, expect } from 'vitest'
import { getLogger, createChildLogger } from '../lib/logger.js'

describe('getLogger', () => {
  it('返回 pino Logger 实例', () => {
    const log = getLogger()
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.warn).toBe('function')
  })

  it('多次调用返回同一个实例', () => {
    const a = getLogger()
    const b = getLogger()
    expect(a).toBe(b)
  })
})

describe('createChildLogger', () => {
  it('返回带绑定额外上下文的子 logger', () => {
    const child = createChildLogger({ requestId: 'test-123', userId: 'user-1' })
    expect(child).toBeDefined()
    expect(typeof child.info).toBe('function')

    // 子 logger 与原 logger 不是同一个实例
    expect(child).not.toBe(getLogger())
  })
})
