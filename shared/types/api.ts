// ============================================================
// API 响应类型 & 客户端错误处理
// ============================================================

// ---- 统一响应 wrapper ----
// 在后端完全迁移前，前端 client 兼容两种格式：
//   新：{ ok: true, data: T }
//   旧：直接返回 T（裸对象/数组）
// 错误统一为：{ ok: false, error: string }

export interface ApiSuccess<T = undefined> {
  ok: true
  data: T
}

export interface ApiFail {
  ok: false
  error: string
}

export type ApiWrapped<T = undefined> = ApiSuccess<T> | ApiFail

// ---- 前端错误类 ----

export class ApiRequestError extends Error {
  public status: number
  public body: Record<string, unknown>
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.body = body ?? {}
  }
}

// ---- 各端点响应形状 ----

import type {
  UserInfo, UserDetail,
  ImportFeatureItem, CatalogFeatureEntry,
} from './models'

/** POST /api/auth/login */
export interface LoginResponse {
  token: string
  user: UserInfo
}

/** GET /api/auth/me */
export interface MeResponse {
  user: UserDetail
}

/** PUT /api/auth/me */
export interface ProfileUpdateResponse {
  ok: true
  token: string
  displayName: string
}

/** PUT /api/auth/me/password */
export interface PasswordChangeResponse {
  ok: true
  token: string
}

/** PUT /api/auth/me/feishu-binding */
export interface FeishuBindingResponse {
  openId: string
  name: string
  avatarUrl: string
}

/** GET /api/auth/me/feishu-binding */
export interface FeishuBindingStatus {
  bound: boolean
  openId?: string
  name?: string
  avatarUrl?: string
}

/** POST /api/features/import */
export interface ImportDiffResponse {
  added: ImportFeatureItem[]
  modified: Array<{ before: Record<string, unknown>; after: ImportFeatureItem; changes: string[] }>
  removed: Array<Record<string, unknown> & { hasContent: boolean }>
  total: number
}

/** POST /api/catalogs/:id/publish */
export interface PublishResponse {
  versionMajor: number
  versionMinor: number
}

/** POST /api/upload/image */
export interface UploadImageResponse {
  url: string
  filename: string
  size: number
}

/** POST create 通用响应 */
export interface CreateResponse {
  id: string
}

/** PUT /api/features/:id/sections */
export interface UpdateSectionsResponse {
  ok: true
  sections: Array<{ key: string; title: string; description?: string }>
}

/** GET /api/catalogs/:id/preview + /versions/:versionId/preview */
export interface ManualPreviewResponse {
  catalog: {
    id: string
    title: string
    targets: string[]
    coverInfo: Record<string, unknown>
    features: CatalogFeatureEntry[]
    projectId: string
    createdAt: string
    updatedAt: string
  }
  features: Array<{
    id: string
    title: string
    description: string
    sections: Array<{ key: string; title: string; description?: string }>
  }>
  markdown: string
  headings: Array<{ level: number; text: string; id: string }>
}

/** GET /api/catalogs/:id/versions/:versionId/preview (version preview) */
export interface VersionPreviewResponse {
  versionMajor: number
  versionMinor: number
  title: string
  markdown: string
  changeNotes: string
  createdAt: string
}

/** GET /api/auth/feishu/bind-url, GET /api/auth/feishu/login-url */
export interface OAuthUrlResponse {
  url: string
}

/** Generic ok */
export type OkResponse = { ok: true }
