import { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { writeFile, mkdir } from 'fs/promises'
import { authMiddleware } from '../auth/middleware.js'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const EXT_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

export async function uploadRoutes(app: FastifyInstance) {
  // 确保上传目录存在
  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'data/uploads/images')
  await mkdir(uploadDir, { recursive: true })

  app.post('/api/upload/image', { preHandler: authMiddleware }, async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.status(400).send({ error: '未选择文件' })

    // 校验类型
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return reply.status(400).send({ error: `不支持的文件类型: ${file.mimetype}，仅支持 PNG/JPG/GIF/WebP` })
    }

    // 校验大小（UPLOAD_MAX_SIZE 单位 MB，默认 10MB）
    const maxMB = parseInt(process.env.UPLOAD_MAX_SIZE || '10')
    const maxSize = maxMB * 1024 * 1024
    const buf = await file.toBuffer()
    if (buf.length > maxSize) {
      return reply.status(400).send({ error: `文件过大，上限 ${Math.round(maxSize / 1024 / 1024)}MB` })
    }

    const filename = `${randomUUID()}${EXT_MAP[file.mimetype] || '.bin'}`
    const filepath = join(uploadDir, filename)
    await writeFile(filepath, buf)

    // 返回访问 URL
    const url = `/uploads/images/${filename}`
    return { url, filename, size: buf.length }
  })
}
