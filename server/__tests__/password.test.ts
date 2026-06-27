import { describe, it, expect } from 'vitest'
import { validatePassword } from '../lib/password.js'

describe('validatePassword', () => {
  it('应拒绝空密码', () => {
    expect(validatePassword('')).toBe('请输入密码')
    expect(validatePassword(null)).toBe('请输入密码')
    expect(validatePassword(undefined)).toBe('请输入密码')
  })

  it('应拒绝少于8位的密码', () => {
    expect(validatePassword('Ab1!')).toBe('密码不能少于8位')
  })

  it('应拒绝超过128位的密码', () => {
    expect(validatePassword('A'.repeat(129))).toBe('密码不能超过128位')
  })

  it('应拒绝不满足3/4规则的密码', () => {
    // 只有小写字母 + 数字 = 仅2类
    expect(validatePassword('abcdefg1')).toBe(
      '密码需包含大写字母、小写字母、数字、特殊字符中至少3种',
    )
    // 只有小写字母 = 仅1类
    expect(validatePassword('abcdefgh')).toBe(
      '密码需包含大写字母、小写字母、数字、特殊字符中至少3种',
    )
  })

  it('应接受满足3/4规则的密码', () => {
    // 大写 + 小写 + 数字
    expect(validatePassword('Abcdefg1')).toBeNull()
    // 大写 + 小写 + 特殊字符
    expect(validatePassword('Abcdefg!')).toBeNull()
    // 小写 + 数字 + 特殊字符
    expect(validatePassword('abcdef1!')).toBeNull()
    // 大写 + 数字 + 特殊字符
    expect(validatePassword('ABCDEF1!')).toBeNull()
    // 四类全满足
    expect(validatePassword('Abcdef1!')).toBeNull()
  })
})
