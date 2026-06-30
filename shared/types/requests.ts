// ============================================================
// API 请求体类型（前后端共享）
// ============================================================

import type { SectionDef, CatalogEntry, ImportApplyOptions } from './models'

// ---- Auth ----

export interface LoginBody {
  username: string
  password: string
}

export interface UpdateProfileBody {
  displayName: string
}

export interface ChangeUsernameBody {
  username: string
}

export interface ChangePasswordBody {
  currentPassword?: string
  newPassword: string
}

export interface NotifyPrefsBody {
  notifyEnabled?: number
  notifyPrefs?: Record<string, boolean>
}

export interface CreateUserBody {
  username: string
  displayName: string
  password: string
  role: string
}

export interface ChangeRoleBody {
  role: string
}

export interface FeishuCodeBody {
  code: string
}

// ---- Projects ----

export interface CreateProjectBody {
  name: string
  description?: string
  reviewChain?: string[]
}

export type UpdateProjectBody = CreateProjectBody

export interface AddMemberBody {
  userId: string
}

export interface ReviewChainBody {
  reviewChain: string[]
}

// ---- Features ----

export interface CreateFeatureBody {
  title: string
  description?: string
  sections?: SectionDef[]
  categoryId?: string
  projectId?: string
  createDefaultSection?: boolean
}

export type UpdateFeatureBody = CreateFeatureBody

export interface UpdateSectionStatusBody {
  status?: string
  assignees?: string[]
  reviewNote?: string
  direct?: boolean
}

export interface UpdateSectionsBody {
  sections: SectionDef[]
}

// ---- Catalogs ----

export interface CreateCatalogBody {
  title?: string
  features?: CatalogEntry[]
  cover?: Record<string, string>
  projectId?: string
}

export type UpdateCatalogBody = CreateCatalogBody

export interface PublishBody {
  changeNotes: string
}

// ---- Categories ----

export interface CreateCategoryBody {
  name: string
  color?: string
  sortOrder?: number
  projectId?: string
}

export type UpdateCategoryBody = CreateCategoryBody

// ---- Documents ----

export interface EnsureDocumentBody {
  docId: string
  featureId: string
  sectionKey: string
}

// ---- 数据导入 ----

export interface ImportApplyReqBody {
  options: ImportApplyOptions
}
