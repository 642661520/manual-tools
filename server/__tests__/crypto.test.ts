import { describe, it, expect } from 'vitest'
import { generateState } from '../lib/crypto.js'

describe('generateState', () => {
  it('默认生成 32 字节的 hex 字符串（64 字符）', () => {
    const state = generateState()
    expect(typeof state).toBe('string')
    expect(state).toHaveLength(64) // 32 bytes → 64 hex chars
    expect(/^[a-f0-9]+$/.test(state)).toBe(true)
  })

  it('指定长度生成对应长度的 hex 字符串', () => {
    const state16 = generateState(16)
    expect(state16).toHaveLength(32)

    const state8 = generateState(8)
    expect(state8).toHaveLength(16)
  })

  it('每次调用生成不同值', () => {
    const a = generateState()
    const b = generateState()
    expect(a).not.toBe(b)
  })
})
