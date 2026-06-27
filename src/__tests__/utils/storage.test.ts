/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'
import { getStoredUser } from '@/utils/storage'

// jsdom 环境手动挂载 localStorage
beforeEach(() => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => { store.clear() },
      get length() { return store.size },
      key: (i: number) => [...store.keys()][i] ?? null,
    },
    configurable: true,
    writable: true,
  })
})

describe('getStoredUser', () => {
  it('无数据时返回 null', () => {
    expect(getStoredUser()).toBeNull()
  })

  it('有效 JSON 时返回解析后的对象', () => {
    const user = { id: '1', username: 'test', displayName: 'Test', role: 'admin' }
    localStorage.setItem('auth_user', JSON.stringify(user))
    expect(getStoredUser()).toEqual(user)
  })

  it('非法 JSON 时返回 null', () => {
    localStorage.setItem('auth_user', '{invalid}')
    expect(getStoredUser()).toBeNull()
  })

  it('空对象存储时返回空对象', () => {
    localStorage.setItem('auth_user', '{}')
    expect(getStoredUser()).toEqual({})
  })
})
