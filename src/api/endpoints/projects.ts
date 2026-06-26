import { api } from '../client'
import type { ProjectInfo, MemberInfo, ReviewChainData, OkResponse } from '@shared/types'
import type { CreateProjectBody, UpdateProjectBody } from '@shared/types'

const BASE = '/api/v1/projects'

export function getProjects(): Promise<ProjectInfo[]> {
  return api.get<ProjectInfo[]>(BASE)
}

export function getProject(id: string): Promise<ProjectInfo> {
  return api.get<ProjectInfo>(`${BASE}/${id}`)
}

export function createProject(data: CreateProjectBody): Promise<ProjectInfo> {
  return api.post<ProjectInfo>(BASE, data)
}

export function updateProject(id: string, data: UpdateProjectBody): Promise<ProjectInfo> {
  return api.put<ProjectInfo>(`${BASE}/${id}`, data)
}

export function deleteProject(id: string): Promise<OkResponse> {
  return api.delete<OkResponse>(`${BASE}/${id}`)
}

// ---- 成员管理 ----

export function getMembers(projectId: string): Promise<MemberInfo[]> {
  return api.get<MemberInfo[]>(`${BASE}/${projectId}/members`)
}

export function addMember(projectId: string, userId: string, projectRole?: string): Promise<OkResponse> {
  return api.post<OkResponse>(`${BASE}/${projectId}/members`, { userId, projectRole })
}

export function removeMember(projectId: string, userId: string): Promise<OkResponse> {
  return api.delete<OkResponse>(`${BASE}/${projectId}/members/${userId}`)
}

// ---- 审核链 ----

export function getReviewChain(projectId: string): Promise<ReviewChainData> {
  return api.get<ReviewChainData>(`${BASE}/${projectId}/review-chain`)
}

export function updateReviewChain(projectId: string, reviewChain: string[]): Promise<OkResponse> {
  return api.put<OkResponse>(`${BASE}/${projectId}/review-chain`, { reviewChain })
}
