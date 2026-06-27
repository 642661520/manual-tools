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
  role: 'admin' | 'member' | 'guest'
  avatarUrl?: string
  feishuName?: string
  // 从 /api/auth/me 获取的额外字段
  hasPassword?: boolean
  notifyEnabled?: boolean
  notifyPrefs?: Record<string, boolean>
  usernameChanged?: boolean
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
  statusLog?: StatusLogEntry[]
}

export interface StatusLogEntry {
  action: 'submitted' | 'approved' | 'rejected' | 'direct_approved' | 'reset_to_draft' | 'reset_to_in_progress'
  userId: string
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

export interface CatalogPart {
  type: 'part'
  id: string
  title: string
  features: CatalogFeatureEntry[]
}

export type CatalogEntry = CatalogFeatureEntry | CatalogPart

export function isCatalogPart(entry: CatalogEntry): entry is CatalogPart {
  return (entry as CatalogPart).type === 'part'
}

export interface CatalogInfo {
  id: string
  title: string
  targets: string[]
  features: CatalogEntry[]
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
  visibility: string
  publishScope: string
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

// ---- 项目成员 ----

export interface MemberInfo {
  id: string
  username: string
  displayName: string
  role: string
  projectRole?: 'pm' | 'writer' | 'viewer'
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
  feishuName: string | null
  feishuAvatarUrl: string | null
}

export interface ReviewChainData {
  chain: ReviewChainMember[]
  availablePMs: ReviewChainMember[]
}

// ---- 数据导入导出 ----

export interface ExportEstimate {
  features: number
  catalogs: number
  documents: number
  uploads: number
  structuredSize: number
  uploadsSize: number
  totalSize: number
}

export interface ImportDiffReport {
  sourceProject: { id: string; name: string }
  categories: { added: string[]; conflicted: { id: string; sourceName: string; targetName: string }[] }
  features: { added: string[]; conflicted: { id: string; sourceTitle: string; targetTitle: string }[] }
  catalogs: { added: string[]; conflicted: { id: string; sourceTitle: string; targetTitle: string }[] }
  documents: { added: number; conflicted: number; skipped: number }
  projectMembers: { added: string[]; unknownUsers: string[] }
  uploads: { total: number; totalSize: number; duplicates: number }
}

export interface ImportApplyResult {
  categories: { inserted: number; updated: number; skipped: number }
  features: { inserted: number; updated: number; skipped: number }
  catalogs: { inserted: number; updated: number; skipped: number }
  documents: { inserted: number; updated: number; skipped: number }
  members: { inserted: number }
  uploads: { copied: number; skipped: number }
}

export interface ImportApplyOptions {
  strategies: {
    categories: Record<string, 'skip' | 'overwrite'>
    features: Record<string, 'skip' | 'overwrite'>
    catalogs: Record<string, 'skip' | 'overwrite'>
    documents: Record<string, 'skip' | 'overwrite'>
  }
  includeMembers: boolean
}

export interface DataTaskInfo {
  id: string
  type: 'export' | 'import'
  scope: string
  status: 'pending' | 'processing' | 'uploaded' | 'analyzed' | 'applying' | 'completed' | 'failed'
  progress: number
  progressLabel: string | null
  fileSize: number | null
  summary: ExportEstimate | null
  diffReport: ImportDiffReport | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  expiresAt: string
}

export interface OrphanFile {
  path: string
  size: number
  mtime: string
}

export interface UploadFileInfo {
  path: string
  size: number
  mtime: string
  /** 是否被文档引用 */
  referenced: boolean
}