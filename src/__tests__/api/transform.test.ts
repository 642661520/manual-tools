/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { toCamelCase } from '@/api/transform'

describe('toCamelCase', () => {
  it('转换简单对象的 snake_case 键为 camelCase', () => {
    const result = toCamelCase({ user_name: 'Alice', display_name: 'Alice Wang' })
    expect(result).toEqual({ userName: 'Alice', displayName: 'Alice Wang' })
  })

  it('递归转换嵌套对象', () => {
    const result = toCamelCase({
      user_info: {
        first_name: 'Alice',
        address_book: { home_phone: '123' },
      },
    })
    expect(result).toEqual({
      userInfo: {
        firstName: 'Alice',
        addressBook: { homePhone: '123' },
      },
    })
  })

  it('转换数组中的对象', () => {
    const result = toCamelCase([{ item_id: '1' }, { item_id: '2' }])
    expect(result).toEqual([{ itemId: '1' }, { itemId: '2' }])
  })

  it('非对象类型原样返回', () => {
    expect(toCamelCase('hello')).toBe('hello')
    expect(toCamelCase(123)).toBe(123)
    expect(toCamelCase(null)).toBeNull()
  })

  it('空对象返回空对象', () => {
    expect(toCamelCase({})).toEqual({})
  })
})
