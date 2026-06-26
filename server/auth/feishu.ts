// 飞书用户角色判定
import { config } from '../config.js'

export function determineRole(openId: string): 'admin' | 'member' {
  const adminList = config.adminOpenIds.split(',').filter(Boolean)
  if (adminList.includes(openId)) return 'admin'

  // 默认角色：成员（可被加入项目，具体权限由项目角色决定）
  return 'member'
}
