import { api } from '../client'

export interface SearchResult {
  docId: string
  featureId: string
  sectionKey: string
  title: string
  sectionTitle: string
  snippet: string
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
}

export function search(q: string, projectId: string, limit = 100): Promise<SearchResponse> {
  return api.get<SearchResponse>(
    `/api/v1/search?q=${encodeURIComponent(q)}&projectId=${encodeURIComponent(projectId)}&limit=${limit}`,
  )
}
