// 数据库行类型
export interface ProjectRow {
  id: string
  name: string
  description: string
  review_chain: string
  created_at: string
  updated_at: string
}

export interface FeatureRow {
  id: string
  title: string
  description: string
  sections: string // JSON string
  is_custom: number
  category_id: string | null
  project_id: string
  created_at: string
  updated_at: string
}

export interface FeatureWithStats extends FeatureRow {
  total_sections: number
  approved_sections: number
  completed_sections: number
  edited_sections: number
  orphaned_count: number
}

export interface DocumentRow {
  id: string
  feature_id: string
  section_key: string
  status: string
  assignees: string // JSON user ID 数组
  review_note: string
  review_step: number
  status_log: string // JSON StatusLogEntry 数组
  updated_at: string
}

export interface CatalogRow {
  id: string
  title: string
  features: string // JSON string
  cover_info: string // JSON string
  project_id: string
  created_at: string
  updated_at: string
}

export interface UserRow {
  id: string
  username: string
  display_name: string
  password_hash: string | null
  role: string
  token_version: number
  feishu_open_id: string | null
  feishu_name: string | null
  feishu_avatar_url: string | null
  username_changed: number
  created_at: string
}

export interface ProjectMemberRow {
  project_id: string
  user_id: string
  role: string
}

export interface UpdateRow {
  update_data: Buffer
}

export interface SnapshotRow {
  snapshot_data: Buffer
}

export interface HasContentRow {
  cnt: number
}

// 请求体类型
export interface CreateFeatureBody {
  title: string
  description?: string
  sections?: { key: string; title: string; description?: string }[]
  categoryId?: string
  projectId?: string
}

export type UpdateFeatureBody = CreateFeatureBody

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

export type DocVisibility = 'public' | 'login_required' | 'project_members'

export type CatalogVersionStatus = 'active' | 'deprecated' | 'archived'

export interface CatalogVersionRow {
  id: string
  catalog_id: string
  version_major: number
  version_minor: number
  title: string
  features_snapshot: string
  change_notes: string
  markdown: string
  status_snapshot: string
  visibility: DocVisibility
  features_json: string
  headings_json: string
  publish_scope: string
  status: CatalogVersionStatus
  created_at: string
}

export interface CreateCatalogBody {
  title?: string
  features?: CatalogEntry[]
  cover?: Record<string, string>
  projectId?: string
}

export type UpdateCatalogBody = CreateCatalogBody

export interface UpdateSectionStatusBody {
  status?: string
  assignees?: string[]
  reviewNote?: string
  direct?: boolean
}

// 状态变更日志条目
export interface StatusLogEntry {
  action:
    | 'submitted'
    | 'approved'
    | 'rejected'
    | 'direct_approved'
    | 'reset_to_draft'
    | 'reset_to_in_progress'
  userId: string
  note: string
  step: number
  created_at: string
}

// 项目类型
export interface CreateProjectBody {
  name: string
  description?: string
  reviewChain?: string[]
}

export type UpdateProjectBody = CreateProjectBody

export interface UpdateSectionsBody {
  sections: { key: string; title: string; description?: string }[]
}

export interface EnsureDocumentBody {
  docId: string
  featureId: string
  sectionKey: string
}

export interface CreateUserBody {
  username: string
  displayName: string
  password: string
  role: string
}

// 分类类型
export interface CategoryRow {
  id: string
  name: string
  color: string
  sort_order: number
  project_id: string
  created_at: string
  updated_at: string
}

export interface CreateCategoryBody {
  name: string
  color?: string
  sort_order?: number
  projectId?: string
}

export type UpdateCategoryBody = CreateCategoryBody

// PDF 生成类型
export interface FeatureData {
  id: string
  title: string
  description: string
  sections: { key: string; title: string; description?: string }[]
}

export interface HeadingEntry {
  level: number
  text: string
  id: string
}

export interface ManualResult {
  catalog: Omit<CatalogRow, 'cover_info' | 'features'> & {
    coverInfo: Record<string, unknown>
    entries: CatalogEntry[]
  }
  features: FeatureData[]
  markdown: string
  headings: HeadingEntry[]
}

// 飞书 OAuth 响应类型
export interface FeishuTokenResponse {
  code: number
  app_access_token: string
}

export interface FeishuUserResponse {
  code: number
  data: {
    access_token: string
  }
}

export interface FeishuUserInfoResponse {
  code: number
  data: {
    open_id: string
    name: string
    avatar_url?: string
  }
}
