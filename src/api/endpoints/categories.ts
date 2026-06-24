import { api } from '../client'
import type { CategoryInfo, OkResponse } from '@shared/types'
import type { CreateCategoryBody, UpdateCategoryBody } from '@shared/types'

const BASE = '/api/v1/categories'

function q(projectId?: string): string {
  return projectId ? `?projectId=${projectId}` : ''
}

export function getCategories(projectId?: string): Promise<CategoryInfo[]> {
  return api.get<CategoryInfo[]>(`${BASE}${q(projectId)}`)
}

export function createCategory(data: CreateCategoryBody): Promise<CategoryInfo> {
  return api.post<CategoryInfo>(BASE, data)
}

export function updateCategory(id: string, data: UpdateCategoryBody): Promise<CategoryInfo> {
  return api.put<CategoryInfo>(`${BASE}/${id}`, data)
}

export function deleteCategory(id: string): Promise<OkResponse> {
  return api.delete<OkResponse>(`${BASE}/${id}`)
}
