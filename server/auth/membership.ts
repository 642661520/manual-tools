// 项目成员检查（供 features、catalogs、projects 路由共用）
import { getDb } from '../db/index.js'

/**
 * 检查用户是否为项目成员。
 * pm 角色全局通过（PM 是可信角色，可在任意项目操作 feature/catalog）。
 */
export function isProjectMember(userId: string, role: string, projectId: string): boolean {
  if (role === 'pm') return true
  const db = getDb()
  const row = db.prepare(
    'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?',
  ).get(projectId, userId)
  return !!row
}

/**
 * 严格检查：用户必须同时在 project_members 表中。
 * 用于成员管理操作——pm 也只能管自己所在项目的成员。
 */
export function isExplicitMember(userId: string, projectId: string): boolean {
  const db = getDb()
  const row = db.prepare(
    'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?',
  ).get(projectId, userId)
  return !!row
}
