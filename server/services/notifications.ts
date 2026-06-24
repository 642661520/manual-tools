// 通知服务：飞书消息推送编排
// 所有函数 fire-and-forget，失败只记日志，不阻断业务
import { getDb } from '../db/index.js'
import { sendFeishuMessage, buildCardMessage } from './feishu.js'

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173'

// ---- 辅助 ----

function getSectionTitle(featureId: string, sectionKey: string): string {
  const db = getDb()
  const feature = db.prepare('SELECT sections FROM features WHERE id = ?').get(featureId) as { sections: string } | undefined
  if (!feature) return sectionKey
  try {
    const sections = JSON.parse(feature.sections) as { key: string; title: string }[]
    return sections.find(s => s.key === sectionKey)?.title || sectionKey
  } catch {
    return sectionKey
  }
}

function getFeatureTitle(featureId: string): string {
  const db = getDb()
  const feature = db.prepare('SELECT title FROM features WHERE id = ?').get(featureId) as { title: string } | undefined
  return feature?.title || featureId
}

/** 检查是否应该向该用户发送某类通知 */
function shouldNotify(userId: string, category: string): boolean {
  const db = getDb()
  const user = db.prepare('SELECT notify_enabled, notify_prefs FROM users WHERE id = ?').get(userId) as { notify_enabled: number; notify_prefs: string } | undefined
  if (!user) return false
  // 全局开关
  if (!user.notify_enabled) return false
  // 分类开关
  try {
    const prefs = JSON.parse(user.notify_prefs || '{}') as Record<string, boolean>
    if (prefs[category] === false) return false
  } catch { /* ignore, default to allow */ }
  return true
}

/** 检查一批用户中哪些该收通知，返回对应的 open_id */
function getNotifiableOpenIds(userIds: string[], category: string, excludeUserId?: string): string[] {
  const filtered = excludeUserId ? userIds.filter(id => id !== excludeUserId) : userIds
  if (filtered.length === 0) return []
  const db = getDb()
  const placeholders = filtered.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT feishu_open_id, notify_enabled, notify_prefs FROM users
    WHERE id IN (${placeholders}) AND feishu_open_id IS NOT NULL
  `).all(...filtered) as { feishu_open_id: string; notify_enabled: number; notify_prefs: string }[]

  return rows.filter(r => {
    if (!r.notify_enabled) return false
    try {
      const prefs = JSON.parse(r.notify_prefs || '{}') as Record<string, boolean>
      if (prefs[category] === false) return false
    } catch { /* allow */ }
    return true
  }).map(r => r.feishu_open_id)
}
function getUserOpenIdById(userId: string): string | null {
  const db = getDb()
  const user = db.prepare('SELECT feishu_open_id FROM users WHERE id = ?').get(userId) as { feishu_open_id: string | null } | undefined
  return user?.feishu_open_id || null
}

function getPMOpenIds(): string[] {
  const db = getDb()
  const pms = db.prepare("SELECT feishu_open_id FROM users WHERE role = 'pm' AND feishu_open_id IS NOT NULL").all() as { feishu_open_id: string }[]
  return pms.map(p => p.feishu_open_id)
}

// ---- 通知函数 ----

/** PM 指派了编写者 → 通知所有被指派人 */
export async function notifyAssignees(
  featureId: string,
  sectionKey: string,
  assigneeIds: string[],
  assignedBy: string,
  excludeUserId?: string,
): Promise<void> {
  try {
    const openIds = getNotifiableOpenIds(assigneeIds, 'assign', excludeUserId)
    if (openIds.length === 0) return

    const featureTitle = getFeatureTitle(featureId)
    const sectionTitle = getSectionTitle(featureId, sectionKey)
    const editorUrl = `${APP_BASE_URL}/features/${featureId}/edit?section=${sectionKey}`

    const card = buildCardMessage(
      '📝 新任务指派',
      `${assignedBy} 指派你编写\n**${featureTitle}** — ${sectionTitle}`,
      { color: 'blue', link: { url: editorUrl, title: '去编写' } },
    )

    await Promise.allSettled(openIds.map(openId => sendFeishuMessage(openId, card)))
  } catch (e: unknown) {
    console.error('通知被指派人失败:', e instanceof Error ? e.message : e)
  }
}

/** 运维提交审核 → 通知审核链中当前环节的审核人 */
export async function notifyNextReviewer(
  featureId: string,
  sectionKey: string,
  reviewerId: string,
  step: number,
  total: number,
  submitterName: string,
): Promise<void> {
  try {
    if (!shouldNotify(reviewerId, 'review')) return
    const openId = getUserOpenIdById(reviewerId)
    if (!openId) return

    const featureTitle = getFeatureTitle(featureId)
    const sectionTitle = getSectionTitle(featureId, sectionKey)
    const editorUrl = `${APP_BASE_URL}/features/${featureId}/edit?section=${sectionKey}`

    const card = buildCardMessage(
      '🔍 待审核',
      `${submitterName} 提交了\n**${featureTitle}** — ${sectionTitle}\n请审阅（第 ${step}/${total} 步）`,
      { color: 'orange', link: { url: editorUrl, title: '去审核' } },
    )

    await sendFeishuMessage(openId, card)
  } catch (e: unknown) {
    console.error('通知审核人失败:', e instanceof Error ? e.message : e)
  }
}

/** PM 审核通过/退回 → 通知所有被指派人（排除执行人） */
export async function notifyWriterReviewResult(
  featureId: string,
  sectionKey: string,
  newStatus: 'approved' | 'rejected',
  reviewNote: string,
  reviewerName: string,
  assigneeIds: string[],
  excludeUserId?: string,
): Promise<void> {
  try {
    const openIds = getNotifiableOpenIds(assigneeIds, 'review', excludeUserId)
    if (openIds.length === 0) return

    const featureTitle = getFeatureTitle(featureId)
    const sectionTitle = getSectionTitle(featureId, sectionKey)
    const editorUrl = `${APP_BASE_URL}/features/${featureId}/edit?section=${sectionKey}`

    const isApproved = newStatus === 'approved'
    const title = isApproved ? '✅ 审核通过' : '↩️ 退回修改'
    const color = isApproved ? 'green' : 'red' as 'green' | 'red'

    let body = `${reviewerName} ${isApproved ? '通过了' : '退回了'}\n**${featureTitle}** — ${sectionTitle}`
    if (reviewNote) {
      body += `\n\n退回理由：${reviewNote}`
    }

    const card = buildCardMessage(title, body, { color, link: { url: editorUrl, title: '查看' } })

    await Promise.allSettled(openIds.map(openId => sendFeishuMessage(openId, card)))
  } catch (e: unknown) {
    console.error('通知审核结果失败:', e instanceof Error ? e.message : e)
  }
}

/** PM 直接通过（跳过审核链）→ 通知所有编写人 */
export async function notifyDirectApprove(
  featureId: string,
  sectionKey: string,
  reviewerName: string,
  assigneeIds: string[],
  excludeUserId?: string,
): Promise<void> {
  try {
    const openIds = getNotifiableOpenIds(assigneeIds, 'review', excludeUserId)
    if (openIds.length === 0) return

    const featureTitle = getFeatureTitle(featureId)
    const sectionTitle = getSectionTitle(featureId, sectionKey)
    const editorUrl = `${APP_BASE_URL}/features/${featureId}/edit?section=${sectionKey}`

    const card = buildCardMessage(
      '✅ 直接通过',
      `${reviewerName} 直接通过了\n**${featureTitle}** — ${sectionTitle}\n（已跳过审核流程）`,
      { color: 'green', link: { url: editorUrl, title: '查看' } },
    )

    await Promise.allSettled(openIds.map(openId => sendFeishuMessage(openId, card)))
  } catch (e: unknown) {
    console.error('通知直接通过失败:', e instanceof Error ? e.message : e)
  }
}

/** PM 重置状态 → 通知所有编写人 */
export async function notifyStatusReset(
  featureId: string,
  sectionKey: string,
  newStatus: string,
  reviewerName: string,
  assigneeIds: string[],
  excludeUserId?: string,
): Promise<void> {
  try {
    const openIds = getNotifiableOpenIds(assigneeIds, 'status', excludeUserId)
    if (openIds.length === 0) return

    const featureTitle = getFeatureTitle(featureId)
    const sectionTitle = getSectionTitle(featureId, sectionKey)
    const editorUrl = `${APP_BASE_URL}/features/${featureId}/edit?section=${sectionKey}`

    const statusLabel = newStatus === 'draft' ? '未开始' : newStatus === 'in_progress' ? '编写中' : newStatus

    const card = buildCardMessage(
      '🔄 状态已重置',
      `${reviewerName} 将状态重置为「${statusLabel}」\n**${featureTitle}** — ${sectionTitle}`,
      { color: 'blue', link: { url: editorUrl, title: '查看' } },
    )

    await Promise.allSettled(openIds.map(openId => sendFeishuMessage(openId, card)))
  } catch (e: unknown) {
    console.error('通知状态重置失败:', e instanceof Error ? e.message : e)
  }
}

/** 新成员飞书注册 → 通知所有 PM 授权 */
export async function notifyNewGuest(displayName: string): Promise<void> {
  try {
    const pmOpenIds = getPMOpenIds()
    if (pmOpenIds.length === 0) return

    const settingsUrl = `${APP_BASE_URL}/settings`

    const card = buildCardMessage(
      '👤 新成员注册',
      `${displayName} 通过飞书登录注册了账号，当前角色为「游客」。\n请前往设置页为其分配操作权限。`,
      { color: 'blue', link: { url: settingsUrl, title: '去设置' } },
    )

    await Promise.allSettled(pmOpenIds.map(openId => sendFeishuMessage(openId, card)))
  } catch (e: unknown) {
    console.error('通知新成员失败:', e instanceof Error ? e.message : e)
  }
}

// ---- P0 通知 ----

/** PM 将用户加入项目 → 通知被加入的用户 */
export async function notifyJoinProject(
  projectName: string,
  targetUserId: string,
  operatorName: string,
): Promise<void> {
  try {
    if (!shouldNotify(targetUserId, 'project')) return
    const openId = getUserOpenIdById(targetUserId)
    if (!openId) return

    const previewUrl = `${APP_BASE_URL}/preview`

    const card = buildCardMessage(
      '👥 已加入项目',
      `${operatorName} 将你加入了项目「${projectName}」\n现在可以参与该项目的编写和审核。`,
      { color: 'blue', link: { url: previewUrl, title: '去查看' } },
    )

    await sendFeishuMessage(openId, card)
  } catch (e: unknown) {
    console.error('通知加入项目失败:', e instanceof Error ? e.message : e)
  }
}

/** PM 将用户移出项目 → 通知被移出的用户 */
export async function notifyLeaveProject(
  projectName: string,
  targetUserId: string,
  operatorName: string,
): Promise<void> {
  try {
    if (!shouldNotify(targetUserId, 'project')) return
    const openId = getUserOpenIdById(targetUserId)
    if (!openId) return

    const card = buildCardMessage(
      '👋 已移出项目',
      `${operatorName} 将你移出了项目「${projectName}」`,
      { color: 'red' },
    )

    await sendFeishuMessage(openId, card)
  } catch (e: unknown) {
    console.error('通知移出项目失败:', e instanceof Error ? e.message : e)
  }
}

/** PM 修改用户角色 → 通知被变更的用户 */
export async function notifyRoleChange(
  targetUserId: string,
  oldRole: string,
  newRole: string,
  operatorName: string,
): Promise<void> {
  try {
    if (!shouldNotify(targetUserId, 'project')) return
    const openId = getUserOpenIdById(targetUserId)
    if (!openId) return

    const roleLabel = (r: string) => r === 'pm' ? '产品' : r === 'ops' ? '运维' : '游客'

    const card = buildCardMessage(
      '🔑 角色变更',
      `${operatorName} 将你的角色从「${roleLabel(oldRole)}」变更为「${roleLabel(newRole)}」`,
      { color: 'blue' },
    )

    await sendFeishuMessage(openId, card)
  } catch (e: unknown) {
    console.error('通知角色变更失败:', e instanceof Error ? e.message : e)
  }
}

/** PM 移除编写人 → 通知被移除的用户 */
export async function notifyRemoveAssignee(
  featureId: string,
  sectionKey: string,
  removedUserId: string,
  operatorName: string,
): Promise<void> {
  try {
    if (!shouldNotify(removedUserId, 'assign')) return
    const openId = getUserOpenIdById(removedUserId)
    if (!openId) return

    const featureTitle = getFeatureTitle(featureId)
    const sectionTitle = getSectionTitle(featureId, sectionKey)

    const card = buildCardMessage(
      '📝 任务已移除',
      `${operatorName} 将你从任务中移除\n**${featureTitle}** — ${sectionTitle}`,
      { color: 'red' },
    )

    await sendFeishuMessage(openId, card)
  } catch (e: unknown) {
    console.error('通知移除编写人失败:', e instanceof Error ? e.message : e)
  }
}
