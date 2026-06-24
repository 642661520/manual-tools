import { api } from '../client'
import type {
  FeatureSummary,
  FeatureDetail,
  ImportDiffResponse,
  UpdateSectionsResponse,
  OkResponse,
  CreateResponse,
} from '@shared/types'
import type {
  CreateFeatureBody,
  UpdateFeatureBody,
  UpdateSectionStatusBody,
  UpdateSectionsBody,
  ImportDiffBody,
  ImportApplyBody,
} from '@shared/types'

const BASE = '/api/features'

function q(projectId?: string): string {
  return projectId ? `?projectId=${projectId}` : ''
}

// ---- CRUD ----

export function getFeatures(projectId?: string): Promise<FeatureSummary[]> {
  return api.get<FeatureSummary[]>(`${BASE}${q(projectId)}`)
}

export function getFeature(id: string): Promise<FeatureDetail> {
  return api.get<FeatureDetail>(`${BASE}/${id}`)
}

export function createFeature(data: CreateFeatureBody): Promise<CreateResponse> {
  return api.post<CreateResponse>(BASE, data)
}

export function updateFeature(id: string, data: UpdateFeatureBody): Promise<OkResponse> {
  return api.put<OkResponse>(`${BASE}/${id}`, data)
}

export function deleteFeature(id: string): Promise<OkResponse> {
  return api.delete<OkResponse>(`${BASE}/${id}`)
}

// ---- 导入 ----

export function importFeatures(projectId: string | undefined, data: ImportDiffBody): Promise<ImportDiffResponse> {
  return api.post<ImportDiffResponse>(`${BASE}/import${q(projectId)}`, data)
}

export function applyImport(projectId: string | undefined, data: ImportApplyBody): Promise<OkResponse> {
  return api.post<OkResponse>(`${BASE}/import/apply${q(projectId)}`, data)
}

// ---- Section 操作 ----

export function updateSectionStatus(
  featureId: string,
  sectionKey: string,
  data: UpdateSectionStatusBody,
): Promise<OkResponse> {
  return api.put<OkResponse>(`${BASE}/${featureId}/sections/${sectionKey}/status`, data)
}

export function deleteOrphaned(featureId: string, sectionKey: string): Promise<OkResponse> {
  return api.delete<OkResponse>(`${BASE}/${featureId}/orphaned/${sectionKey}`)
}

export function updateSections(featureId: string, data: UpdateSectionsBody): Promise<UpdateSectionsResponse> {
  return api.put<UpdateSectionsResponse>(`${BASE}/${featureId}/sections`, data)
}
