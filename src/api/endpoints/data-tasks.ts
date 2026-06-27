// ============================================================
// 数据任务 API：导出/导入/孤儿清理
// ============================================================

import { api } from '../client'
import type {
  ExportEstimate, ImportDiffReport, ImportApplyOptions,
  ImportApplyResult, DataTaskInfo, OrphanFile, UploadFileInfo,
} from '@shared/types'
import type { OkResponse } from '@shared/types'

const TASKS = '/api/v1/data-tasks'

// ---- 项目导出 ----

export function getExportEstimate(projectId: string): Promise<ExportEstimate> {
  return api.get<ExportEstimate>(`/api/v1/projects/${projectId}/export/estimate`)
}

export function startExport(projectId: string): Promise<{ taskId: string }> {
  return api.post<{ taskId: string }>(`/api/v1/projects/${projectId}/export`)
}

// ---- 项目导入 ----

export function uploadImport(projectId: string, file: File): Promise<{ taskId: string }> {
  const fd = new FormData()
  fd.append('file', file)
  return api.upload<{ taskId: string }>(`/api/v1/projects/${projectId}/import/upload`, fd)
}

// ---- 任务通用操作 ----

export function listTasks(scope?: string): Promise<DataTaskInfo[]> {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : ''
  return api.get<DataTaskInfo[]>(`${TASKS}${query}`)
}

export function getTask(taskId: string): Promise<DataTaskInfo> {
  return api.get<DataTaskInfo>(`${TASKS}/${taskId}`)
}

export function analyzeImport(taskId: string): Promise<ImportDiffReport> {
  return api.get<ImportDiffReport>(`${TASKS}/${taskId}/analyze`)
}

export function applyImport(taskId: string, options: ImportApplyOptions): Promise<ImportApplyResult> {
  return api.post<ImportApplyResult>(`${TASKS}/${taskId}/apply`, { options })
}

export function deleteTask(taskId: string): Promise<OkResponse> {
  return api.delete<OkResponse>(`${TASKS}/${taskId}`)
}

/** 下载导出的 ZIP 文件 */
export function downloadExport(taskId: string): Promise<void> {
  return api.download(`${TASKS}/${taskId}/download`, 'export.zip')
}

// ---- 系统备份 ----

export function startSystemExport(): Promise<{ taskId: string }> {
  return api.post<{ taskId: string }>('/api/v1/system/export')
}

// ---- 孤儿清理 ----

export function getOrphans(): Promise<{ orphans: OrphanFile[]; totalSize: number }> {
  return api.get<{ orphans: OrphanFile[]; totalSize: number }>('/api/v1/uploads/orphans')
}

export function deleteOrphans(): Promise<{ deleted: number; freedBytes: number }> {
  return api.delete<{ deleted: number; freedBytes: number }>('/api/v1/uploads/orphans')
}

// ---- 上传资源管理 ----

export function getUploads(): Promise<{ files: UploadFileInfo[]; totalSize: number; totalCount: number; referencedCount: number; orphanedCount: number }> {
  return api.get<{ files: UploadFileInfo[]; totalSize: number; totalCount: number; referencedCount: number; orphanedCount: number }>('/api/v1/uploads')
}

export function deleteUpload(filePath: string): Promise<OkResponse> {
  return api.delete<OkResponse>(`/api/v1/uploads?filePath=${encodeURIComponent(filePath)}`)
}
