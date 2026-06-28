// ============================================================
// 种子 ZIP 构建器
// 将 content.ts 中的数据构建为导入格式 (v2) 的 ZIP
// ============================================================

import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { config } from '../../config.js'

const require = createRequire(import.meta.url)
const { ZipArchive } = require('archiver')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const IMAGES_DIR = path.join(__dirname, 'images')
const UPLOADS_BASE = config.uploadDir

interface SeedImage {
  buffer: Buffer
  zipPath: string
}

/**
 * 处理 HTML 中的图片引用：
 * - ../../uploads/images/filename.png（无 hash）→ 从 images/ 目录查找 → 计算 SHA-256 → 替换为 ../../uploads/images/{shard}/{hash}.ext
 * - ../../uploads/images/ab/fullhash.ext（已哈希）→ 保持路径，从 data/uploads/ 收集文件
 */
function processImageRefs(html: string): {
  html: string
  images: Map<string, SeedImage>
} {
  const images = new Map<string, SeedImage>()

  // 匹配所有相对路径 uploads 引用
  const relRegex = /\.\.\/\.\.\/uploads\/(images\/(?:[a-f0-9]{2}\/)?)([^"'\s>]+)/g
  let match: RegExpExecArray | null

  while ((match = relRegex.exec(html)) !== null) {
    const fullMatch = match[0]
    const dirPart = match[1] // "images/" or "images/ab/"
    const filename = match[2]

    if (images.has(fullMatch)) continue

    const nameWithoutExt = filename.replace(/\.[^.]+$/, '')
    const isHashed = /^[a-f0-9]{64}$/.test(nameWithoutExt)
    const hasShard = dirPart !== 'images/'

    if (isHashed && hasShard) {
      // 已哈希文件：从 data/uploads/ 收集
      const ref = `${dirPart}${filename}` // "images/ab/hash.png"
      const filePath = path.join(UPLOADS_BASE, ref)
      if (!fs.existsSync(filePath)) {
        console.warn(`[seed] 上传文件不存在，跳过: ${ref}`)
        continue
      }
      const buffer = fs.readFileSync(filePath)
      images.set(fullMatch, { buffer, zipPath: ref })
    } else {
      // 非哈希文件：从 images/ 目录查找
      const imagePath = path.join(IMAGES_DIR, filename)
      if (!fs.existsSync(imagePath)) {
        console.warn(`[seed] 种子图片不存在，跳过引用: ${filename}（请放入 server/db/seed-manual/images/）`)
        continue
      }
      const buffer = fs.readFileSync(imagePath)
      const hash = createHash('sha256').update(buffer).digest('hex')
      const ext = path.extname(filename)
      const zipPath = `images/${hash.slice(0, 2)}/${hash}${ext}`
      const newRelPath = `../../uploads/${zipPath}`

      html = html.split(fullMatch).join(newRelPath)
      images.set(newRelPath, { buffer, zipPath })
    }
  }

  return { html, images }
}

/** 构建种子 ZIP 文件（v2 导入格式） */
export async function buildSeedZip(projectId: string): Promise<{
  zipBuffer: Buffer
  images: Map<string, SeedImage>
}> {
  const content = await import('./content.js')
  const { SEED_CATEGORIES, SEED_FEATURES, SEED_DOCUMENTS, SEED_CATALOG } = content

  // 处理所有 HTML 文档 + 收集图片
  const allImages = new Map<string, SeedImage>()
  const processedDocs = new Map<string, string>() // docId → processed HTML

  for (const [docId, html] of Object.entries(SEED_DOCUMENTS)) {
    const { html: processedHtml, images } = processImageRefs(html)
    processedDocs.set(docId, processedHtml)
    for (const [name, info] of images) {
      if (!allImages.has(name)) allImages.set(name, info)
    }
  }

  // 打包 ZIP（v2 格式）
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const chunks: Buffer[] = []

  await new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', resolve)
    archive.on('error', reject)

    // manifest.json
    archive.append(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          source: { projectId, projectName: '默认项目' },
        },
        null,
        2,
      ),
      { name: 'manifest.json' },
    )

    // project.json
    archive.append(
      JSON.stringify(
        {
          id: projectId,
          name: '默认项目',
          description: '系统初始化创建',
        },
        null,
        2,
      ),
      { name: 'project.json' },
    )

    // categories.json
    archive.append(JSON.stringify(SEED_CATEGORIES, null, 2), { name: 'categories.json' })

    // features/{id}.json
    for (const f of SEED_FEATURES) {
      archive.append(
        JSON.stringify(
          {
            id: f.id,
            title: f.title,
            description: f.description,
            sections: f.sections,
            is_custom: f.is_custom ?? 0,
            category_id: f.category_id,
          },
          null,
          2,
        ),
        { name: `features/${f.id}.json` },
      )
    }

    // documents/{feature-id}/{section-key}.html
    for (const [docId, html] of processedDocs) {
      const [featureId, sectionKey] = docId.split('/')
      archive.append(html, { name: `documents/${featureId}/${sectionKey}.html` })
    }

    // catalogs/{id}.json
    archive.append(
      JSON.stringify(
        {
          id: SEED_CATALOG.id,
          title: SEED_CATALOG.title,
          targets: SEED_CATALOG.targets,
          features: SEED_CATALOG.features,
          cover_info: SEED_CATALOG.cover_info,
          versions: [],
        },
        null,
        2,
      ),
      { name: `catalogs/${SEED_CATALOG.id}.json` },
    )

    // uploads/
    for (const [, info] of allImages) {
      archive.append(info.buffer, { name: `uploads/${info.zipPath}` })
    }

    archive.finalize()
  })

  return {
    zipBuffer: Buffer.concat(chunks),
    images: allImages,
  }
}
