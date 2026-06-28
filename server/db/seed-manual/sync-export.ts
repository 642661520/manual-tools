// ============================================================
// CLI 脚本：将默认项目的文档内容 + 图片回写到种子文件
// 开发阶段：网页编辑 → 运行此脚本 → 提交更新的文件
// 用法: pnpm seed:export
// ============================================================

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDatabase } from '../index.js'
import { config } from '../../config.js'
import { yjsDataToHtml } from '../../lib/yjs-utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCUMENTS_DIR = path.join(__dirname, 'documents')
const IMAGES_DIR = path.join(__dirname, 'images')
const UPLOADS_BASE = config.uploadDir

// 初始化数据库
initDatabase()

const { getDb } = await import('../index.js')
const db = getDb()

let exported = 0
let imagesCopied = 0
let skipped = 0

/**
 * 将绝对路径 uploads 引用转换为相对路径，并复制图片文件到 images/ 目录
 * /uploads/images/ab/fullhash.png → ../../uploads/images/ab/fullhash.png
 */
function convertUploadRefsToSeed(html: string): string {
  const regex = /\/uploads\/(images\/[a-f0-9]{2}\/([a-f0-9]{64})(\.\w+))/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(html)) !== null) {
    const fullRef = match[1] // "images/ab/hash.png"
    const hash = match[2] // "abchash..."
    const ext = match[3] // ".png"

    const sourcePath = path.join(UPLOADS_BASE, fullRef)
    if (!fs.existsSync(sourcePath)) {
      console.log(`  ⚠ 图片文件不存在: ${fullRef}`)
      continue
    }

    // 复制到 images/ 目录
    const seedName = `uploaded-${hash.slice(0, 12)}${ext}`
    const destPath = path.join(IMAGES_DIR, seedName)

    // 检查是否已存在相同内容的文件
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(sourcePath, destPath)
      imagesCopied++
    }

    // 替换为相对路径
    html = html.split(`/uploads/${fullRef}`).join(`../../uploads/${fullRef}`)
  }

  return html
}

function exportDocuments(): void {
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    console.error('[seed:export] documents/ 目录不存在')
    process.exit(1)
  }

  // 确保 images/ 目录存在
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true })
  }

  const featureDirs = fs.readdirSync(DOCUMENTS_DIR, { withFileTypes: true })

  for (const dir of featureDirs) {
    if (!dir.isDirectory()) continue
    const featureKey = dir.name
    const featureDir = path.join(DOCUMENTS_DIR, featureKey)
    const files = fs.readdirSync(featureDir)

    for (const file of files) {
      if (!file.endsWith('.html')) continue
      const sectionKey = file.replace('.html', '')
      const docId = `manual-tools:${featureKey}/${sectionKey}`
      const filePath = path.join(featureDir, file)

      // 从数据库读取 Y.js 文档内容
      const snapshot = db
        .prepare(
          'SELECT snapshot_data FROM document_snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 1',
        )
        .get(docId) as { snapshot_data: Buffer } | undefined

      if (!snapshot) {
        console.log(`  ○ ${featureKey}/${sectionKey}.html (数据库无内容，跳过)`)
        skipped++
        continue
      }

      try {
        const updates = db
          .prepare('SELECT update_data FROM document_updates WHERE document_id = ? ORDER BY id ASC')
          .all(docId) as { update_data: Buffer }[]

        // 解码 Y.js → HTML
        let html = yjsDataToHtml(
          snapshot.snapshot_data,
          updates.map((u) => u.update_data),
        )

        if (!html.trim()) {
          console.log(`  ○ ${featureKey}/${sectionKey}.html (内容为空，跳过)`)
          skipped++
          continue
        }

        // 绝对路径 → 相对路径 + 复制图片
        html = convertUploadRefsToSeed(html)

        // 写回 .html 文件
        fs.writeFileSync(filePath, html.trim(), 'utf-8')
        console.log(`  ✓ ${featureKey}/${sectionKey}.html`)
        exported++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`  ✗ ${featureKey}/${sectionKey}.html: ${msg}`)
      }
    }
  }

  console.log(`\n回写完成: ${exported} 篇文档, ${imagesCopied} 张图片, ${skipped} 篇跳过`)
}

exportDocuments()
process.exit(0)
