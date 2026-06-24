import { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { authMiddleware, requireRole } from '../auth/middleware.js'
import path from 'path'
import fs from 'fs'

export async function backupRoutes(app: FastifyInstance) {
  // 网页手动导出备份（下载 SQLite + uploads 的 zip）
  app.get('/api/v1/backup/download', { preHandler: [authMiddleware, requireRole('pm')] }, async (_req, reply) => {
    const db = getDb()
    const tmpDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads', '../backups/tmp')
    fs.mkdirSync(tmpDir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dbBackupPath = path.join(tmpDir, `manual-${timestamp}.db`)

    // 备份数据库
    await db.backup(dbBackupPath)

    // 返回数据库文件（简化版：只下载 DB，upload 文件另外处理）
    reply.header('Content-Type', 'application/octet-stream')
    reply.header('Content-Disposition', `attachment; filename="manual-${timestamp}.db"`)

    const buffer = fs.readFileSync(dbBackupPath)
    fs.unlinkSync(dbBackupPath)
    return buffer
  })
}
