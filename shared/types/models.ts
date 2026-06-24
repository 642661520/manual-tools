// ============================================================
// 前后端共享的领域模型类型
// 字段名统一使用 camelCase（前端友好），
// 后端通过 transform 适配 snake_case 数据库字段
// ============================================================

// ---- 用户 ----

export interface UserInfo {
  id: string
  username: string
  displayName: string
  role: 'pm' | 'ops' | 'guest'
  avatarUrl?: string
  feishuName?: string
  // 从 /api/auth/me 获取的额外字段
  hasPassword?: boolean
  notifyEnabled?: boolean
  notifyPrefs?: Record<string, boolean>
}

export interface UserDetail extends UserInfo {
  feishuOpenId: string | null
  feishuAvatarUrl: string | null
  createdAt: string
  hasPassword: boolean
  notifyEnabled: boolean
  notifyPrefs: Record<string, boolean>
}

// ---- 项目 ----

export interface ProjectInfo {
  id: string
  name: string
  description: string
  reviewChain: string[]
  createdAt: string
  updatedAt: string
}

// ---- 功能 ----

export interface SectionDef {
  key: string
  title: string
  description?: string
}

export interface FeatureSection extends SectionDef {
  status?: string
  assignees?: string[]
  reviewNote?: string
  reviewStep?: number
  reviewLog?: ReviewLogEntry[]
}

export interface ReviewLogEntry {
  action: 'approved' | 'rejected'
  reviewerId: string
  note: string
  step: number
  createdAt: string
}

export interface FeatureInfo {
  id: string
  title: string
  description: string
  sections: SectionDef[]
  isCustom: boolean
  categoryId: string | null
  projectId: string
  createdAt: string
  updatedAt: string
}

export interface FeatureSummary extends FeatureInfo {
  totalSections: number
  approvedSections: number
  completedSections: number
  editedSections: number
  orphanedCount: number
}

export interface FeatureDetail extends FeatureInfo {
  sections: FeatureSection[]
  orphaned: FeatureSection[]
}

// ---- 目录/手册 ----

export interface CatalogFeatureEntry {
  featureId: string
  sectionOrder?: string[]
}

export interface CatalogInfo {
  id: string
  title: string
  targets: string[]
  features: CatalogFeatureEntry[]
  coverInfo: Record<string, unknown>
  projectId: string
  createdAt: string
  updatedAt: string
}

export interface CatalogVersionInfo {
  id: string
  versionMajor: number
  versionMinor: number
  title: string
  changeNotes: string
  createdAt: string
}

// ---- 分类 ----

export interface CategoryInfo {
  id: string
  name: string
  color: string
  sortOrder: number
  projectId: string
}

// ---- 待办 ----

export interface TodoItem {
  docId: string
  featureId: string
  featureTitle: string
  sectionKey: string
  sectionTitle: string
  status: string
  reviewNote: string
  reviewStep: number
  todoType: 'write' | 'review'
}

// ---- 文档 ----

export type DocumentStatus = 'draft' | 'in_progress' | 'pending_review' | 'rejected' | 'approved'

// ---- 数据导入 ----

export interface ImportFeatureItem {
  id: string
  title: string
  description: string
  sections?: SectionDef[]
}

// ---- 项目成员 ----

export interface MemberInfo {
  id: string
  username: string
  displayName: string
  role: string
  feishuOpenId: string | null
  feishuName: string | null
  feishuAvatarUrl: string | null
}

// ---- 审核链 ----

export interface ReviewChainMember {
  id: string
  username: string
  displayName: string
  role: string
}

export interface ReviewChainData {
  chain: ReviewChainMember[]
  availablePMs: ReviewChainMember[]
}
