import { FastifyInstance } from 'fastify'
import { createHash } from 'crypto'
import { join } from 'path'
import { writeFile, mkdir, access } from 'fs/promises'
import { authMiddleware } from '../auth/middleware.js'
import { success, fail } from '../lib/response.js'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

const VIDEO_TYPES = ['video/mp4', 'video/webm']
const VIDEO_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
}

const UPLOAD_BASE = process.env.UPLOAD_DIR || join(process.cwd(), 'data/uploads')

/** 通用上传处理：校验类型 → 大小 → 哈希去重 → 返回 URL */
async function handleUpload(
  file: { mimetype: string; toBuffer: () => Promise<Buffer> },
  allowedTypes: string[],
  extMap: Record<string, string>,
  maxMB: number,
  subDir: string,
): Promise<{ url: string; filename: string; size: number }> {
  if (!allowedTypes.includes(file.mimetype)) {
    const names = allowedTypes.map(t => t.split('/')[1].toUpperCase()).join('/')
    throw new Error(`不支持的文件类型: ${file.mimetype}，仅支持 ${names}`)
  }

  const maxSize = maxMB * 1024 * 1024
  const buf = await file.toBuffer()
  if (buf.length > maxSize) {
    throw new Error(`文件过大，上限 ${maxMB}MB`)
  }

  const dir = join(UPLOAD_BASE, subDir)
  await mkdir(dir, { recursive: true })

  const hash = createHash('sha256').update(buf).digest('hex')
  const ext = extMap[file.mimetype] || '.bin'
  const filename = `${hash}${ext}`
  const filepath = join(dir, filename)

  const exists = await access(filepath).then(() => true).catch(() => false)
  if (!exists) {
    await writeFile(filepath, buf)
  }

  return { url: `/uploads/${subDir}/${filename}`, filename, size: buf.length }
}

export async function uploadRoutes(app: FastifyInstance) {
  // 图片上传
  app.post('/api/v1/upload/image', { preHandler: authMiddleware }, async (req, reply) => {
    const file = await req.file()
    if (!file) return fail(reply, 400, '未选择文件')
    try {
      const maxMB = parseInt(process.env.UPLOAD_MAX_SIZE || '10')
      const result = await handleUpload(file, IMAGE_TYPES, IMAGE_EXT, maxMB, 'images')
      return success(result)
    } catch (e: unknown) {
      return fail(reply, 400, (e as Error).message)
    }
  })

  // 视频上传
  app.post('/api/v1/upload/video', { preHandler: authMiddleware }, async (req, reply) => {
    const file = await req.file()
    if (!file) return fail(reply, 400, '未选择文件')
    try {
      const maxMB = parseInt(process.env.VIDEO_MAX_SIZE || '100')
      const result = await handleUpload(file, VIDEO_TYPES, VIDEO_EXT, maxMB, 'videos')
      return success(result)
    } catch (e: unknown) {
      return fail(reply, 400, (e as Error).message)
    }
  })
}
