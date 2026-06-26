import { api } from '../client'
import type {
  CatalogInfo,
  CatalogVersionInfo,
  ManualPreviewResponse,
  VersionPreviewResponse,
  ChapterResponse,
  PublishResponse,
  OkResponse,
  CreateResponse,
} from '@shared/types'
import type { CreateCatalogBody, UpdateCatalogBody } from '@shared/types'

const BASE = '/api/v1/catalogs'

function q(projectId?: string): string {
  return projectId ? `?projectId=${projectId}` : ''
}

// ---- CRUD ----

export function getCatalogs(projectId?: string): Promise<CatalogInfo[]> {
  return api.get<CatalogInfo[]>(`${BASE}${q(projectId)}`)
}

export function getCatalog(id: string): Promise<CatalogInfo & { features: Array<{ featureId: string; sectionOrder?: string[]; feature: Record<string, unknown> }> }> {
  return api.get(`${BASE}/${id}`)
}

export function createCatalog(data: CreateCatalogBody): Promise<CreateResponse> {
  return api.post<CreateResponse>(BASE, data)
}

export function updateCatalog(id: string, data: UpdateCatalogBody): Promise<OkResponse> {
  return api.put<OkResponse>(`${BASE}/${id}`, data)
}

export function deleteCatalog(id: string): Promise<OkResponse> {
  return api.delete<OkResponse>(`${BASE}/${id}`)
}

// ---- 预览 ----

export function getPreview(id: string, mode?: string): Promise<ManualPreviewResponse> {
  const m = mode ? `?mode=${mode}` : ''
  return api.get<ManualPreviewResponse>(`${BASE}/${id}/preview${m}`)
}

// ---- 版本 ----

export function getVersions(id: string): Promise<CatalogVersionInfo[]> {
  return api.get<CatalogVersionInfo[]>(`${BASE}/${id}/versions`)
}

export function getVersionPreview(id: string, versionId: string, mode?: string): Promise<VersionPreviewResponse> {
  const m = mode ? `?mode=${mode}` : ''
  return api.get<VersionPreviewResponse>(`${BASE}/${id}/versions/${versionId}/preview${m}`)
}

export function getChapter(id: string, chNum: number, mode?: string): Promise<ChapterResponse> {
  const m = mode ? `?mode=${mode}` : ''
  return api.get<ChapterResponse>(`${BASE}/${id}/chapters/${chNum}${m}`)
}

export function getVersionChapter(id: string, versionId: string, chNum: number, mode?: string): Promise<ChapterResponse> {
  const m = mode ? `?mode=${mode}` : ''
  return api.get<ChapterResponse>(`${BASE}/${id}/versions/${versionId}/chapters/${chNum}${m}`)
}

// ---- 发布 ----

export function publishCatalog(id: string, changeNotes: string, visibility?: string): Promise<PublishResponse> {
  return api.post<PublishResponse>(`${BASE}/${id}/publish`, { changeNotes, visibility })
}

// ---- 可见性 ----

export function updateVersionVisibility(catalogId: string, versionId: string, visibility: string): Promise<{ ok: true }> {
  return api.put<{ ok: true }>(`${BASE}/${catalogId}/versions/${versionId}/visibility`, { visibility })
}

// ---- 导出 ----

export function getMarkdownExportUrl(id: string): string {
  return `${BASE}/${id}/export/markdown`
}
