/** 密码学安全的随机数工具函数 */
import { randomBytes } from 'crypto'

/** 生成安全的随机状态字符串（用于 OAuth state 参数） */
export function generateState(length = 32): string {
  return randomBytes(length).toString('hex')
}
