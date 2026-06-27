// 项目成员检查（供 features、catalogs、projects 路由共用）
import { getDb } from '../db/index.js'

/** 项目角色层级：数字越大权限越高 */
const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 1,
  writer: 2,
  pm: 3,
}

/**
 * 检查用户是否为项目成员。
 * admin 全局通过。
 */
export function isProjectMember(userId: string, role: string, projectId: string): boolean {
  if (role === 'admin') return true
  const db = getDb()
  const row = db.prepare(
    'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?',
  ).get(projectId, userId)
  return !!row
}

/**
 * 检查 catalog 是否存在且用户有权访问。
 * 统一 catalog 路由中重复的 fetch + member check 模式。
 * @returns { projectId } 或 null（不存在/无权限）
 */
export function assertCatalogMember(
  db: ReturnType<typeof getDb>,
  catalogId: string,
  userId: string,
  role: string,
): { projectId: string } | null {
  const meta = db.prepare('SELECT project_id FROM catalogs WHERE id = ?').get(catalogId) as { project_id: string } | undefined
  if (!meta) return null
  if (!isProjectMember(userId, role, meta.project_id)) return null
  return { projectId: meta.project_id }
}

/**
 * 检查用户在项目中的角色是否满足最低要求。
 * admin 自动满足所有项目角色。
 * @param minRole 最低要求的项目角色 (viewer < writer < pm)
 */
export function hasProjectRole(
  userId: string,
  systemRole: string,
  projectId: string,
  minRole: 'viewer' | 'writer' | 'pm',
): boolean {
  if (systemRole === 'admin') return true
  const db = getDb()
  const row = db.prepare(
    'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
  ).get(projectId, userId) as { role: string } | undefined
  if (!row) return false
  return (ROLE_HIERARCHY[row.role] || 0) >= (ROLE_HIERARCHY[minRole] || 0)
}

/**
 * 严格检查：用户必须显式在 project_members 表中。
 * 用于成员管理操作。
 * admin 可以管理任何项目的成员。
 */
export function isExplicitMember(userId: string, role: string, projectId: string): boolean {
  if (role === 'admin') return true
  const db = getDb()
  const row = db.prepare(
    'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?',
  ).get(projectId, userId)
  return !!row
}
