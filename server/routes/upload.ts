import { FastifyInstance } from 'fastify'
import { createHash } from 'crypto'
import { join } from 'path'
import { writeFile, mkdir, access } from 'fs/promises'
import { authMiddleware } from '../auth/middleware.js'
import { success, fail } from '../lib/response.js'
import { config } from '../config.js'

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

const UPLOAD_BASE = config.uploadDir

/** Magic bytes 签名映射表：offset → 期望的字节序列 */
const MAGIC_SIGNATURES: Record<string, { offset: number; bytes: number[] }> = {
  'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  'image/gif': { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  'image/webp': { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  'video/mp4': { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  'video/webm': { offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
}

/** 校验文件 magic bytes 是否匹配声明的 MIME 类型 */
function verifyMagicBytes(mimetype: string, buffer: Buffer): boolean {
  const sig = MAGIC_SIGNATURES[mimetype]
  if (!sig) return true // 未收录的类型跳过校验
  if (buffer.length < sig.offset + sig.bytes.length) return false
  return sig.bytes.every((b, i) => buffer[sig.offset + i] === b)
}

/** 通用上传处理：校验类型 → 校验 magic bytes → 大小 → 哈希去重 → 返回 URL */
async function handleUpload(
  file: { mimetype: string; toBuffer: () => Promise<Buffer> },
  allowedTypes: string[],
  extMap: Record<string, string>,
  maxMB: number,
  subDir: string,
): Promise<{ url: string; filename: string; size: number }> {
  if (!allowedTypes.includes(file.mimetype)) {
    const names = allowedTypes.map((t) => t.split('/')[1].toUpperCase()).join('/')
    throw new Error(`不支持的文件类型: ${file.mimetype}，仅支持 ${names}`)
  }

  const maxSize = maxMB * 1024 * 1024
  const buf = await file.toBuffer()
  if (buf.length > maxSize) {
    throw new Error(`文件过大，上限 ${maxMB}MB`)
  }

  // 校验 magic bytes：防止将非图片/视频文件伪装为合法类型
  if (!verifyMagicBytes(file.mimetype, buf)) {
    throw new Error(`文件类型不匹配：声明为 ${file.mimetype}，但实际内容不符`)
  }

  const hash = createHash('sha256').update(buf).digest('hex')
  const ext = extMap[file.mimetype] || '.bin'
  const filename = `${hash}${ext}`
  const shard = hash.slice(0, 2)
  const dir = join(UPLOAD_BASE, subDir, shard)
  await mkdir(dir, { recursive: true })

  const filepath = join(dir, filename)

  const exists = await access(filepath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    await writeFile(filepath, buf)
  }

  return { url: `/uploads/${subDir}/${shard}/${filename}`, filename, size: buf.length }
}

export async function uploadRoutes(app: FastifyInstance) {
  // 图片上传
  app.post('/api/v1/upload/image', { preHandler: authMiddleware }, async (req, reply) => {
    const file = await req.file()
    if (!file) return fail(reply, 400, '未选择文件')
    try {
      const maxMB = config.uploadMaxSize
      const result = await handleUpload(file, IMAGE_TYPES, IMAGE_EXT, maxMB, 'images')
      return success(result)
    } catch (e: unknown) {
      return fail(reply, 400, e instanceof Error ? e.message : '图片上传失败')
    }
  })

  // 视频上传
  app.post('/api/v1/upload/video', { preHandler: authMiddleware }, async (req, reply) => {
    const file = await req.file()
    if (!file) return fail(reply, 400, '未选择文件')
    try {
      const maxMB = config.videoMaxSize
      const result = await handleUpload(file, VIDEO_TYPES, VIDEO_EXT, maxMB, 'videos')
      return success(result)
    } catch (e: unknown) {
      return fail(reply, 400, e instanceof Error ? e.message : '视频上传失败')
    }
  })
}
