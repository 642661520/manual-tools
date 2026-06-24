import { api } from '../client'
import type {
  CatalogInfo,
  CatalogVersionInfo,
  ManualPreviewResponse,
  VersionPreviewResponse,
  PublishResponse,
  OkResponse,
  CreateResponse,
} from '@shared/types'
import type { CreateCatalogBody, UpdateCatalogBody } from '@shared/types'

const BASE = '/api/catalogs'

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

export function getVersionExportUrl(id: string, versionId: string, mode?: string): string {
  const m = mode ? `?mode=${mode}` : ''
  return `${BASE}/${id}/versions/${versionId}/export${m}`
}

// ---- 发布 ----

export function publishCatalog(id: string, changeNotes: string): Promise<PublishResponse> {
  return api.post<PublishResponse>(`${BASE}/${id}/publish`, { changeNotes })
}

// ---- 导出 ----

export function getExportUrl(id: string, mode?: string): string {
  const m = mode ? `?mode=${mode}` : ''
  return `${BASE}/${id}/export${m}`
}

export function getMarkdownExportUrl(id: string): string {
  return `${BASE}/${id}/export/markdown`
}
