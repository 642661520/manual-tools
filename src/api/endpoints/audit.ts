import { api } from '../client'

const BASE = '/api/v1/audit-logs'

export interface AuditLogEntry {
  id: string
  userId: string
  username: string
  action: string
  targetType: string
  targetId: string
  detail: string
  createdAt: string
}

export interface AuditLogPage {
  rows: AuditLogEntry[]
  total: number
}

export function getAuditLogs(params?: {
  userId?: string
  action?: string
  targetType?: string
  limit?: number
  offset?: number
}): Promise<AuditLogPage> {
  const query = new URLSearchParams()
  if (params?.userId) query.set('userId', params.userId)
  if (params?.action) query.set('action', params.action)
  if (params?.targetType) query.set('targetType', params.targetType)
  if (params?.limit != null) query.set('limit', String(params.limit))
  if (params?.offset != null) query.set('offset', String(params.offset))
  const qs = query.toString()
  return api.get<AuditLogPage>(`${BASE}${qs ? '?' + qs : ''}`)
}
