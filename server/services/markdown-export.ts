import { ZipArchive } from 'archiver'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import { config } from '../config.js'
import type { ManualResult } from '../types.js'

interface ImageEntry {
  /** Markdown 中的原始 URL */
  original: string
  /** zip 中的本地文件名 */
  filename: string
  /** 图片数据 */
  buffer: Buffer | null
}

/**
 * 从 Markdown 内容中提取所有图片引用，
 * 下载/读取图片数据，替换为本地路径，
 * 最后打包为 zip 的 ReadableStream。
 */
export async function buildMarkdownZip(manual: ManualResult): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
  const imageMap = await collectImages(manual.markdown)
  const mdWithLocalImages = replaceImageUrls(manual.markdown, imageMap)

  const archive = new ZipArchive({ zlib: { level: 6 } })
  const safeTitle = manual.catalog.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)

  // 写入 Markdown 文件
  archive.append(mdWithLocalImages, { name: `${safeTitle}.md` })

  // 写入图片文件
  for (const img of imageMap) {
    if (img.buffer) {
      archive.append(img.buffer, { name: `images/${img.filename}` })
    }
  }

  archive.finalize()

  const filename = `${encodeURIComponent(safeTitle)}-markdown.zip`
  return { stream: archive, filename }
}

/** 收集所有图片：外链下载、本地文件读取 */
async function collectImages(md: string): Promise<ImageEntry[]> {
  const urls = extractImageUrls(md)
  const entries: ImageEntry[] = []
  const seen = new Set<string>()

  for (const url of urls) {
    // 去重
    if (seen.has(url)) continue
    seen.add(url)

    const filename = `${uuid().slice(0, 8)}${extFromUrl(url)}`
    const buffer = await fetchImage(url)
    entries.push({ original: url, filename, buffer })
  }

  return entries
}

/** 正则提取 Markdown/HTML 中的图片 URL */
function extractImageUrls(md: string): string[] {
  const urls: string[] = []
  // Markdown 图片: ![alt](url)
  const mdRe = /!\[.*?\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = mdRe.exec(md)) !== null) {
    urls.push(m[1])
  }
  // HTML 图片: <img src="url">
  const htmlRe = /<img[^>]+src="([^"]+)"/gi
  while ((m = htmlRe.exec(md)) !== null) {
    urls.push(m[1])
  }
  return urls
}

/** 获取图片数据：外链下载、本地读取 */
async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    // 补全协议相对 URL
    const fullUrl = url.startsWith('//') ? `https:${url}` : url

    if (fullUrl.startsWith('http://') || fullUrl.startsWith('https://')) {
      // 外链：fetch 下载
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(fullUrl, { signal: controller.signal })
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer())
          return buf
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    if (fullUrl.startsWith('/uploads/')) {
      // 本地上传文件
      const uploadDir = config.uploadDir
      const filepath = join(uploadDir, fullUrl.replace(/^\/uploads\/images\//, ''))
      if (existsSync(filepath)) {
        return readFileSync(filepath)
      }
    }

    return null
  } catch {
    return null
  }
}

/** 将 Markdown 中的图片 URL 替换为本地相对路径 */
function replaceImageUrls(md: string, images: ImageEntry[]): string {
  let result = md
  for (const img of images) {
    if (!img.buffer) continue
    const escaped = escapeRegex(img.original)
    result = result.replace(new RegExp(escaped, 'g'), `images/${img.filename}`)
  }
  return result
}

function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url.startsWith('//') ? `https:${url}` : url).pathname
    const ext = pathname.split('.').pop()?.toLowerCase()
    const valid = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
    return valid.includes(ext || '') ? `.${ext}` : '.png'
  } catch {
    return '.png'
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
