// Token 验证缓存 + 当前用户状态：供 main.ts (路由守卫) 和 useAuth.ts (login/logout) 共享
// 避免循环依赖 — 两端都能读写 currentUser，确保 validateToken() 拉取的用户数据能同步到 UI

import { ref } from 'vue'
import type { UserInfo } from '@shared/types'
import { getStoredUser } from './storage'

// ---- Token 验证缓存 ----

let tokenValidated = false
let tokenValid = false

/** 检查 token 是否已验证通过（仅缓存成功结果） */
export function isTokenValid(): boolean {
  return tokenValidated && tokenValid
}

/** 设置 token 验证结果 */
export function setTokenValid(valid: boolean): void {
  tokenValidated = true
  tokenValid = valid
}

/** 重置 token 验证缓存，login/logout 后调用 */
export function resetTokenValidation(): void {
  tokenValidated = false
  tokenValid = false
}

// ---- 当前用户（模块级 ref，useAuth 与 validateToken 共享） ----

/** 当前登录用户 ref — useAuth 与 validateToken 共享同一引用 */
export const currentUser = ref<UserInfo | null>(getStoredUser())
