import { api } from '../client'
import type { TodoItem } from '@shared/types'

export function getTodos(projectId?: string): Promise<TodoItem[]> {
  const p = projectId ? `?projectId=${projectId}` : ''
  return api.get<TodoItem[]>(`/api/v1/todos${p}`)
}
