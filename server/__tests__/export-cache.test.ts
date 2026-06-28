import { describe, it, expect } from 'vitest'
import { computeOptionsHash } from '../services/export-cache.js'

describe('computeOptionsHash', () => {
  it('生成 8 字符 hex hash', () => {
    const hash = computeOptionsHash({})
    expect(hash).toHaveLength(8)
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true)
  })

  it('相同参数生成相同 hash', () => {
    const a = computeOptionsHash({ approvedOnly: true, mode: 'markdown' })
    const b = computeOptionsHash({ approvedOnly: true, mode: 'markdown' })
    expect(a).toBe(b)
  })

  it('不同参数生成不同 hash', () => {
    const a = computeOptionsHash({ approvedOnly: true })
    const b = computeOptionsHash({ approvedOnly: false })
    expect(a).not.toBe(b)
  })

  it('缺失字段使用默认值归一化', () => {
    // 不传和传默认值应一致
    const a = computeOptionsHash({})
    const b = computeOptionsHash({ approvedOnly: false, statusOverride: {}, mode: '' })
    expect(a).toBe(b)
  })
})
