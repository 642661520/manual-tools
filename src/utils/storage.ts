/** 本地存储工具函数 */

import type { UserInfo } from '@shared/types'

/** 从 localStorage 安全读取已认证用户信息 */
export function getStoredUser<T = UserInfo>(): T | null {
  try {
    const stored = localStorage.getItem('auth_user')
    return stored ? (JSON.parse(stored) as T) : null
  } catch {
    return null
  }
}
