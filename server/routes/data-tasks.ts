// ============================================================
// 数据任务路由：项目导入导出 + 系统备份 + 孤儿清理
// ============================================================

import { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import { config } from '../config.js'
import { success, ok, fail } from '../lib/response.js'
import { v4 as uuid } from 'uuid'
import fs from 'fs'
import path from 'path'
import { estimateExport, runExportTask } from '../services/export-service.js'
import { analyzeImport, applyImport } from '../services/import-service.js'
import { getOrphanFiles, deleteOrphanFiles, getUploadsList, deleteUploadFile } from '../services/upload-cleaner.js'
import type { ImportApplyOptions } from '../../shared/types/models.js'

const EXPORT_BASE = config.exportDir
const IMPORT_BASE = config.importDir

export async function dataTaskRoutes(app: FastifyInstance) {
  // ============================================================
  // 项目导出
  // ============================================================

  // 预估导出大小
  app.get('/api/v1/projects/:id/export/estimate', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req) => {
    const { id } = req.params as { id: string }
    const estimate = estimateExport(id)
    return success(estimate)
  })

  // 创建导出任务
  app.post('/api/v1/projects/:id/export', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    // 验证项目存在
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
    if (!project) return fail(reply, 404, '项目不存在')

    const taskId = uuid().slice(0, 12)
    const scope = `project:${id}`

    db.prepare(`
      INSERT INTO data_tasks (id, type, scope, status, progress, created_by)
      VALUES (?, 'export', ?, 'pending', 0, ?)
    `).run(taskId, scope, req.user!.userId)

    // 异步执行导出
    db.prepare("UPDATE data_tasks SET status = 'processing' WHERE id = ?").run(taskId)

    runExportTask(taskId, id, (progress, label) => {
      db.prepare(
        'UPDATE data_tasks SET progress = ?, progress_label = ? WHERE id = ?',
      ).run(progress, label, taskId)
    }).then(({ filePath, fileSize, summary }) => {
      db.prepare(
        "UPDATE data_tasks SET status = 'completed', progress = 100, file_path = ?, file_size = ?, summary = ?, completed_at = datetime('now') WHERE id = ?",
      ).run(filePath, fileSize, JSON.stringify(summary), taskId)
    }).catch((e: unknown) => {
      db.prepare(
        "UPDATE data_tasks SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?",
      ).run(e instanceof Error ? e.message : '导出失败', taskId)
    })

    return success({ taskId })
  })

  // ============================================================
  // 项目导入
  // ============================================================

  // 上传导入 ZIP
  app.post('/api/v1/projects/:id/import/upload', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
    if (!project) return fail(reply, 404, '项目不存在')

    const file = await req.file()
    if (!file) return fail(reply, 400, '请选择 ZIP 文件')

    const buf = await file.toBuffer()
    if (buf.length === 0) return fail(reply, 400, '文件为空')

    const taskId = uuid().slice(0, 12)
    const scope = `project:${id}`

    // 保存到临时目录
    const importDir = IMPORT_BASE
    if (!fs.existsSync(importDir)) {
      fs.mkdirSync(importDir, { recursive: true })
    }
    const filePath = path.join(importDir, `${taskId}.zip`)
    fs.writeFileSync(filePath, buf)

    db.prepare(`
      INSERT INTO data_tasks (id, type, scope, status, file_path, file_size, created_by)
      VALUES (?, 'import', ?, 'uploaded', ?, ?, ?)
    `).run(taskId, scope, filePath, buf.length, req.user!.userId)

    return success({ taskId })
  })

  // ============================================================
  // 数据任务通用操作
  // ============================================================

  // 列出任务（按 scope 过滤，可选）
  app.get('/api/v1/data-tasks', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req) => {
    const { scope } = req.query as { scope?: string }
    const db = getDb()

    let rows: Array<{
      id: string; type: string; scope: string; status: string; progress: number
      progress_label: string | null; file_size: number | null; summary: string | null
      diff_report: string | null; error_message: string | null
      created_at: string; completed_at: string | null; expires_at: string
    }>

    if (scope) {
      rows = db.prepare(
        'SELECT id, type, scope, status, progress, progress_label, file_size, summary, diff_report, error_message, created_at, completed_at, expires_at FROM data_tasks WHERE scope = ? ORDER BY created_at DESC LIMIT 20',
      ).all(scope) as typeof rows
    } else {
      rows = db.prepare(
        'SELECT id, type, scope, status, progress, progress_label, file_size, summary, diff_report, error_message, created_at, completed_at, expires_at FROM data_tasks ORDER BY created_at DESC LIMIT 50',
      ).all() as typeof rows
    }

    return success(rows.map(t => ({
      id: t.id,
      type: t.type,
      scope: t.scope,
      status: t.status,
      progress: t.progress,
      progressLabel: t.progress_label,
      fileSize: t.file_size,
      summary: t.summary ? JSON.parse(t.summary) : null,
      diffReport: t.diff_report ? JSON.parse(t.diff_report) : null,
      errorMessage: t.error_message,
      createdAt: t.created_at,
      completedAt: t.completed_at,
      expiresAt: t.expires_at,
    })))
  })

  // 获取任务状态
  app.get('/api/v1/data-tasks/:id', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const task = db.prepare('SELECT * FROM data_tasks WHERE id = ?').get(id) as {
      id: string
      type: string
      scope: string
      status: string
      progress: number
      progress_label: string | null
      file_path: string | null
      file_size: number | null
      summary: string | null
      diff_report: string | null
      error_message: string | null
      created_by: number
      created_at: string
      completed_at: string | null
      expires_at: string
    } | undefined

    if (!task) return fail(reply, 404, '任务不存在')

    return success({
      id: task.id,
      type: task.type,
      scope: task.scope,
      status: task.status,
      progress: task.progress,
      progressLabel: task.progress_label,
      fileSize: task.file_size,
      summary: task.summary ? JSON.parse(task.summary) : null,
      diffReport: task.diff_report ? JSON.parse(task.diff_report) : null,
      errorMessage: task.error_message,
      createdAt: task.created_at,
      completedAt: task.completed_at,
      expiresAt: task.expires_at,
    })
  })

  // 流式下载导出文件
  app.get('/api/v1/data-tasks/:id/download', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const task = db.prepare(
      'SELECT * FROM data_tasks WHERE id = ? AND type = ?',
    ).get(id, 'export') as {
      status: string; file_path: string | null; expires_at: string
    } | undefined

    if (!task) return fail(reply, 404, '任务不存在')
    if (task.status !== 'completed') return fail(reply, 400, '任务未完成')
    if (!task.file_path || !fs.existsSync(task.file_path)) {
      return fail(reply, 404, '导出文件不存在或已过期')
    }
    if (new Date(task.expires_at + 'Z') < new Date()) {
      return fail(reply, 410, '文件已过期')
    }

    const fileName = path.basename(task.file_path)
    const stream = fs.createReadStream(task.file_path)
    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
    return reply.send(stream)
  })

  // 分析导入差异
  app.get('/api/v1/data-tasks/:id/analyze', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const task = db.prepare(
      'SELECT * FROM data_tasks WHERE id = ? AND type = ?',
    ).get(id, 'import') as {
      status: string; scope: string; file_path: string | null
    } | undefined

    if (!task) return fail(reply, 404, '任务不存在')
    if (task.status !== 'uploaded' && task.status !== 'analyzed') {
      return fail(reply, 400, '任务状态不允许分析')
    }
    if (!task.file_path || !fs.existsSync(task.file_path)) {
      return fail(reply, 404, '上传文件不存在')
    }

    const targetProjectId = task.scope.replace(/^project:/, '')

    try {
      const diff = await analyzeImport(task.file_path, targetProjectId)
      db.prepare(
        "UPDATE data_tasks SET status = 'analyzed', diff_report = ? WHERE id = ?",
      ).run(JSON.stringify(diff), id)
      return success(diff)
    } catch (e: unknown) {
      return fail(reply, 400, e instanceof Error ? e.message : '导入分析失败')
    }
  })

  // 执行导入
  app.post('/api/v1/data-tasks/:id/apply', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const body = req.body as { options: ImportApplyOptions }

    if (!body.options?.strategies) {
      return fail(reply, 400, '请提供导入策略')
    }

    const task = db.prepare(
      'SELECT * FROM data_tasks WHERE id = ? AND type = ?',
    ).get(id, 'import') as {
      status: string; scope: string; file_path: string | null
    } | undefined

    if (!task) return fail(reply, 404, '任务不存在')
    if (task.status !== 'analyzed') {
      return fail(reply, 400, '请先完成差异分析')
    }
    if (!task.file_path || !fs.existsSync(task.file_path)) {
      return fail(reply, 404, '上传文件不存在')
    }

    const targetProjectId = task.scope.replace(/^project:/, '')

    try {
      db.prepare("UPDATE data_tasks SET status = 'applying' WHERE id = ?").run(id)

      const result = await applyImport(task.file_path, targetProjectId, body.options)

      db.prepare(
        "UPDATE data_tasks SET status = 'completed', progress = 100, file_size = ?, completed_at = datetime('now') WHERE id = ?",
      ).run(JSON.stringify(result).length, id)

      return success(result)
    } catch (e: unknown) {
      db.prepare(
        "UPDATE data_tasks SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?",
      ).run(e instanceof Error ? e.message : '导入执行失败', id)
      return fail(reply, 500, e instanceof Error ? e.message : '导入执行失败')
    }
  })

  // 删除任务
  app.delete('/api/v1/data-tasks/:id', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()

    const task = db.prepare(
      'SELECT file_path FROM data_tasks WHERE id = ?',
    ).get(id) as { file_path: string | null } | undefined

    if (!task) return fail(reply, 404, '任务不存在')

    if (task.file_path) {
      try { fs.unlinkSync(task.file_path) } catch { /* ignore */ }
    }
    db.prepare('DELETE FROM data_tasks WHERE id = ?').run(id)

    return ok()
  })

  // ============================================================
  // 系统级导出
  // ============================================================

  app.post('/api/v1/system/export', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async () => {
    const db = getDb()
    const taskId = uuid().slice(0, 12)

    db.prepare(`
      INSERT INTO data_tasks (id, type, scope, status, progress)
      VALUES (?, 'export', 'system', 'processing', 0)
    `).run(taskId)

    const exportDir = EXPORT_BASE
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = path.join(exportDir, `system-backup-${timestamp}.db`)

    // 系统备份直接导出数据库文件
    try {
      db.prepare(
        "UPDATE data_tasks SET progress = 50, progress_label = '正在备份数据库...' WHERE id = ?",
      ).run(taskId)

      await db.backup(filePath)

      const fileSize = fs.statSync(filePath).size
      db.prepare(
        "UPDATE data_tasks SET status = 'completed', progress = 100, file_path = ?, file_size = ?, completed_at = datetime('now') WHERE id = ?",
      ).run(filePath, fileSize, taskId)
    } catch (e: unknown) {
      db.prepare(
        "UPDATE data_tasks SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?",
      ).run(e instanceof Error ? e.message : '备份失败', taskId)
    }

    return success({ taskId })
  })

  // ============================================================
  // 上传资源管理
  // ============================================================

  app.get('/api/v1/uploads', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async () => {
    const result = getUploadsList()
    return success(result)
  })

  app.delete('/api/v1/uploads', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (req, reply) => {
    const { filePath } = req.query as { filePath?: string }
    if (!filePath) return fail(reply, 400, '缺少 filePath 参数')
    try {
      deleteUploadFile(filePath)
      return ok()
    } catch (e: unknown) {
      return fail(reply, 400, e instanceof Error ? e.message : '删除失败')
    }
  })

  // ============================================================
  // 孤儿文件清理
  // ============================================================

  app.get('/api/v1/uploads/orphans', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async () => {
    const orphans = getOrphanFiles()
    const totalSize = orphans.reduce((sum, o) => sum + o.size, 0)
    return success({ orphans, totalSize })
  })

  app.delete('/api/v1/uploads/orphans', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async () => {
    const result = deleteOrphanFiles()
    return success(result)
  })
}
