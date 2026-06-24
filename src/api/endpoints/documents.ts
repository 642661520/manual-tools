import { api } from '../client'
import type { OkResponse } from '@shared/types'
import type { EnsureDocumentBody } from '@shared/types'

export function ensureDocument(data: EnsureDocumentBody): Promise<OkResponse> {
  return api.post<OkResponse>('/api/v1/documents/ensure', data)
}
