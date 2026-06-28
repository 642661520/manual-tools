import { describe, it, expect } from 'vitest'
import { parsePagination } from '../lib/pagination.js'

describe('parsePagination', () => {
  it('默认值：limit=30, offset=0', () => {
    const result = parsePagination({})
    expect(result).toEqual({ limit: 30, offset: 0 })
  })

  it('从 query string 中解析', () => {
    const result = parsePagination({ limit: '10', offset: '20' })
    expect(result).toEqual({ limit: 10, offset: 20 })
  })

  it('limit 为 0 时使用默认值', () => {
    const result = parsePagination({ limit: '0' })
    expect(result.limit).toBe(30) // Math.max(1, 0) → 1, then 1 → valid
  })

  it('offset 为负数时使用 0', () => {
    const result = parsePagination({ offset: '-5' })
    expect(result.offset).toBe(0)
  })

  it('limit 超过 MAX_LIMIT(200) 时截断', () => {
    const result = parsePagination({ limit: '500' })
    expect(result.limit).toBe(200)
  })

  it('自定义 defaultLimit', () => {
    const result = parsePagination({}, { limit: 50 })
    expect(result.limit).toBe(50)
  })

  it('自定义 maxLimit', () => {
    const result = parsePagination({ limit: '150' }, { maxLimit: 100 })
    expect(result.limit).toBe(100)
  })

  it('query 值为 undefined 时使用默认值', () => {
    const result = parsePagination({ limit: undefined, offset: undefined })
    expect(result).toEqual({ limit: 30, offset: 0 })
  })

  it('非数字字符串 fallback 到默认值', () => {
    const result = parsePagination({ limit: 'abc', offset: 'xyz' })
    expect(result.limit).toBe(30)
    expect(result.offset).toBe(0)
  })

  it('空字符串 fallback 到默认值', () => {
    const result = parsePagination({ limit: '', offset: '' })
    expect(result.limit).toBe(30)
    expect(result.offset).toBe(0)
  })

  it('limit=1 正常工作（最小值）', () => {
    const result = parsePagination({ limit: '1' })
    expect(result.limit).toBe(1)
  })

  it('offset=0 正常工作', () => {
    const result = parsePagination({ offset: '0' })
    expect(result.offset).toBe(0)
  })

  it('大 offset 正常工作', () => {
    const result = parsePagination({ offset: '10000' })
    expect(result.offset).toBe(10000)
  })
})
