import { api } from '../client'

export interface AiRequest {
  action: 'polish' | 'summarize' | 'fix' | 'expand' | 'custom'
  content: string
  instruction?: string
}

export interface AiResponse {
  result: string
}

export function aiChat(req: AiRequest): Promise<AiResponse> {
  return api.post<AiResponse>('/api/v1/ai/chat', req)
}
