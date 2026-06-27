// ============================================================
// API 响应类型 & 客户端错误处理
// ============================================================

// ---- 统一响应 wrapper ----
// 成功：{ ok: true, data: T }
// 失败：{ ok: false, error: string }

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
  CatalogEntry,
  ExportEstimate, ImportDiffReport, ImportApplyResult, OrphanFile, DataTaskInfo,
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
  token: string
  displayName: string
}

/** PUT /api/auth/me/username */
export interface UsernameChangeResponse {
  token: string
  username: string
}

/** PUT /api/auth/me/password */
export interface PasswordChangeResponse {
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
  sections: Array<{ key: string; title: string; description?: string }>
}

/** GET /api/catalogs/:id/preview（仅返回结构化数据，不含 markdown） */
export interface ManualPreviewResponse {
  catalog: {
    id: string
    title: string
    targets: string[]
    coverInfo: Record<string, unknown>
    entries: CatalogEntry[]
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
  headings: Array<{ level: number; text: string; id: string }>
}

/** GET /api/catalogs/:id/chapters/:chNum */
export interface ChapterResponse {
  chNum: number
  featureId: string
  featureTitle: string
  markdown: string
  headings: Array<{ level: number; text: string; id: string }>
  totalChapters: number
  hasParts: boolean
  partTitle?: string
  partIdx?: number
}

/** GET /api/catalogs/:id/versions/:versionId/preview（仅返回结构化数据） */
export interface VersionPreviewResponse {
  versionMajor: number
  versionMinor: number
  title: string
  changeNotes: string
  createdAt: string
  features: Array<{
    id: string
    title: string
    description: string
    sections: Array<{ key: string; title: string; description?: string }>
  }>
  headings: Array<{ level: number; text: string; id: string }>
  entries: CatalogEntry[]
}

/** GET /api/auth/feishu/bind-url, GET /api/auth/feishu/login-url */
export interface OAuthUrlResponse {
  url: string
}

/** Generic ok */
export type OkResponse = { ok: true }

/** GET /api/v1/projects/:id/export/estimate */
export type ExportEstimateResponse = ExportEstimate

/** GET /api/v1/data-tasks/:id/analyze */
export type ImportAnalyzeResponse = ImportDiffReport

/** POST /api/v1/data-tasks/:id/apply */
export type ImportApplyResponse = ImportApplyResult

/** GET /api/v1/data-tasks/:id */
export type DataTaskResponse = DataTaskInfo

/** GET /api/v1/uploads/orphans */
export interface OrphansResponse {
  orphans: OrphanFile[]
  totalSize: number
}

/** DELETE /api/v1/uploads/orphans */
export interface OrphansDeleteResponse {
  deleted: number
  freedBytes: number
}