import { ZipArchive } from 'archiver'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import { config } from '../config.js'
import { getOrFetch } from './remote-cache.js'
import type { ManualResult } from '../types.js'

interface ResourceEntry {
  /** Markdown 中的原始 URL */
  original: string
  /** zip 中的本地文件名 */
  filename: string
  /** 文件数据 */
  buffer: Buffer | null
}

/**
 * 从 Markdown 内容中提取所有远程资源引用（图片/视频/音频），
 * 下载/读取文件数据，替换为本地路径，
 * 最后打包为 zip 的 ReadableStream。
 */
export async function buildMarkdownZip(
  manual: ManualResult,
): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
  const resourceMap = await collectResources(manual.markdown)
  const mdWithLocalUrls = replaceResourceUrls(manual.markdown, resourceMap)

  const archive = new ZipArchive({ zlib: { level: 6 } })
  const safeTitle = manual.catalog.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)

  // 写入 Markdown 文件
  archive.append(mdWithLocalUrls, { name: `${safeTitle}.md` })

  // 写入资源文件（图片、视频等）
  for (const res of resourceMap) {
    if (res.buffer) {
      archive.append(res.buffer, { name: `resources/${res.filename}` })
    }
  }

  archive.finalize()

  const filename = `${safeTitle}-markdown.zip`
  return { stream: archive, filename }
}

/** 收集所有远程资源：外链下载、本地文件读取 */
async function collectResources(md: string): Promise<ResourceEntry[]> {
  const urls = extractRemoteUrls(md)
  const entries: ResourceEntry[] = []
  const seen = new Set<string>()

  for (const url of urls) {
    // 去重
    if (seen.has(url)) continue
    seen.add(url)

    const filename = `${uuid().slice(0, 8)}${extFromUrl(url)}`
    const buffer = await fetchRemote(url)
    entries.push({ original: url, filename, buffer })
  }

  return entries
}

/** 正则提取 Markdown/HTML 中的远程资源 URL（图片、视频、音频等） */
function extractRemoteUrls(md: string): string[] {
  const urls: string[] = []
  // Markdown 图片: ![alt](url)
  const mdRe = /!\[.*?\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = mdRe.exec(md)) !== null) {
    urls.push(m[1])
  }
  // HTML 图片: <img src="url">
  const imgRe = /<img[^>]+src="([^"]+)"/gi
  while ((m = imgRe.exec(md)) !== null) {
    urls.push(m[1])
  }
  // HTML 视频: <video src="url">
  const videoRe = /<video[^>]+src="([^"]+)"/gi
  while ((m = videoRe.exec(md)) !== null) {
    urls.push(m[1])
  }
  // HTML 视频源: <source src="url">
  const sourceRe = /<source[^>]+src="([^"]+)"/gi
  while ((m = sourceRe.exec(md)) !== null) {
    urls.push(m[1])
  }
  return urls
}

/** 获取远程资源数据：优先从缓存获取，缓存未命中则下载并存缓存 */
async function fetchRemote(url: string): Promise<Buffer | null> {
  try {
    // 补全协议相对 URL
    const fullUrl = url.startsWith('//') ? `https:${url}` : url

    if (fullUrl.startsWith('http://') || fullUrl.startsWith('https://')) {
      // 外链：使用缓存层获取
      const cached = await getOrFetch(fullUrl)
      if (cached) {
        return readFileSync(cached.filepath)
      }
      // 缓存失败，尝试直接下载（不缓存超大文件场景的降级）
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(fullUrl, { signal: controller.signal })
        if (res.ok) {
          return Buffer.from(await res.arrayBuffer())
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    if (fullUrl.startsWith('/uploads/')) {
      // 本地上传文件（兼容新旧两种路径格式）
      const uploadDir = config.uploadDir
      // 仅剥离 /uploads/ 前缀，保留 images/ 或 videos/ 及可选的 shard 子目录
      const filepath = join(uploadDir, fullUrl.replace(/^\/uploads\//, ''))
      if (existsSync(filepath)) {
        return readFileSync(filepath)
      }
    }

    return null
  } catch {
    return null
  }
}

/** 将 Markdown 中的远程资源 URL 替换为本地相对路径 */
function replaceResourceUrls(md: string, resources: ResourceEntry[]): string {
  let result = md
  for (const res of resources) {
    if (!res.buffer) continue
    const escaped = escapeRegex(res.original)
    result = result.replace(new RegExp(escaped, 'g'), `resources/${res.filename}`)
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
