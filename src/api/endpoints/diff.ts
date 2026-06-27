import { api } from '../client'

export interface DiffResult {
  v1: { major: number; minor: number; title: string }
  v2: { major: number; minor: number; title: string }
  lines: { type: 'added' | 'removed' | 'unchanged'; text: string }[]
  stats: { added: number; removed: number; unchanged: number }
}

export function getDiff(catalogId: string, v1: string, v2: string): Promise<DiffResult> {
  return api.get<DiffResult>(`/api/v1/catalogs/${catalogId}/diff?v1=${v1}&v2=${v2}`)
}
