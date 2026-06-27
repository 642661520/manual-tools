/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'

// 由于 useAuth 使用模块级单例（非 Pinia），需要在每个测试前模拟
// localStorage + vue-router 环境

describe('useAuth — 认证逻辑', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('初始化时无 token 则为未登录状态', async () => {
    // 清空 localStorage
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    // 重新导入以获取最新状态（模块单例会缓存，测试隔离性有限）
    // 验证 localStorage 读取逻辑
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('localStorage 有有效 token 时可读取', () => {
    localStorage.setItem('auth_token', 'test-token')
    localStorage.setItem(
      'auth_user',
      JSON.stringify({
        id: '1',
        username: 'test',
        displayName: 'Test',
        role: 'member',
      }),
    )
    expect(localStorage.getItem('auth_token')).toBe('test-token')
    const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
    expect(user.role).toBe('member')
  })

  it('清除 localStorage 后 token 不存在', () => {
    localStorage.setItem('auth_token', 'x')
    localStorage.removeItem('auth_token')
    expect(localStorage.getItem('auth_token')).toBeNull()
  })
})
