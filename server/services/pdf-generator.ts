import * as Y from 'yjs'
import { getDb } from '../db/index.js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { PDFDocument, PDFHexString, PDFRef, PDFName, PDFDict, PDFObject } from 'pdf-lib'
import type { CatalogRow, CatalogFeatureEntry, FeatureRow, FeatureData, HeadingEntry, ManualResult, SnapshotRow, UpdateRow } from '../types.js'

// pdf-lib context API 未完整导出类型，用最小接口约束
// 实际类型参见 pdf-lib/src/core/document/PDFContext.ts
interface PDFContextLike {
  obj: (init: Record<string, unknown>) => PDFDict
  register: (obj: PDFObject) => PDFRef
  lookup: (ref: PDFRef) => PDFObject | undefined
}

export function assembleManual(catalogId: string, opts?: { approvedOnly?: boolean; featureOverride?: string; statusOverride?: Record<string, string> }): ManualResult | null {
  const approvedOnly = opts?.approvedOnly ?? false
  const statusOverride = opts?.statusOverride
  const db = getDb()
  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(catalogId) as CatalogRow | undefined
  if (!catalog) return null

  const entries: CatalogFeatureEntry[] = JSON.parse(opts?.featureOverride || catalog.features)
  const targets: string[] = JSON.parse(catalog.targets)
  const coverInfo = JSON.parse(catalog.cover_info || '{}')

  const features: FeatureData[] = []
  for (const entry of entries) {
    const f = db.prepare('SELECT * FROM features WHERE id = ?').get(entry.featureId) as FeatureRow | undefined
    if (!f) continue
    const rawSections = JSON.parse(f.sections || '[]') as { key: string; title: string; description?: string }[]
    const ordered = entry.sectionOrder
      ? entry.sectionOrder.map(k => rawSections.find(s => s.key === k)).filter(Boolean) as typeof rawSections
      : rawSections

    // 审核过滤：优先用快照状态，否则查当前 documents 表
    const sections = approvedOnly
      ? ordered.filter(s => {
          const docId = `${f.id}/${s.key}`
          if (statusOverride && docId in statusOverride) {
            return statusOverride[docId] === 'approved'
          }
          const doc = db.prepare('SELECT status FROM documents WHERE id = ?').get(docId) as { status: string } | undefined
          return doc?.status === 'approved'
        })
      : ordered

    features.push({
      id: f.id,
      title: f.title,
      description: f.description,
      sections,
    })
  }

  // 构建 featureId → 章节信息 映射（用于交叉引用解析）
  const chapterMap = new Map<string, {
    num: number
    anchorId: string
    title: string
    sections: Record<string, { anchorId: string; title: string }>
  }>()
  let chNum = 1
  for (const f of features) {
    const sectionAnchors: Record<string, { anchorId: string; title: string }> = {}
    for (let i = 0; i < f.sections.length; i++) {
      const sec = f.sections[i]
      sectionAnchors[sec.key] = {
        anchorId: headingId(`ch${chNum}-s${i + 1}`),
        title: sec.title,
      }
    }
    chapterMap.set(f.id, {
      num: chNum,
      anchorId: headingId(`ch${chNum}`),
      title: f.title,
      sections: sectionAnchors,
    })
    chNum++
  }

  // 收集标题树（用于 PDF 书签）
  const headings: HeadingEntry[] = []

  // 组装 Markdown
  let md = ''

  // 封面
  md += `# ${catalog.title}\n\n`
  if (coverInfo.subtitle) md += `### ${coverInfo.subtitle}\n\n`
  md += `> ${new Date().toISOString().slice(0, 10)}\n\n`
  md += `---\n\n`

  // 目录
  md += `## 目录\n\n`
  let chapterNum = 1
  const tocLines: string[] = []
  for (const f of features) {
    const hid = headingId(`ch${chapterNum}`)
    tocLines.push(`${chapterNum}. [${f.title}](#${hid})`)
    for (let i = 0; i < f.sections.length; i++) {
      const sid = headingId(`ch${chapterNum}-s${i + 1}`)
      tocLines.push(`   ${chapterNum}.${i + 1} [${f.sections[i].title}](#${sid})`)
    }
    chapterNum++
  }
  md += tocLines.join('\n')
  md += `\n\n---\n\n`

  // 正文
  chapterNum = 1
  for (const f of features) {
    const chId = headingId(`ch${chapterNum}`)
    md += `## <a id="${chId}"></a>${chapterNum}. ${f.title}\n\n`
    headings.push({ level: 2, text: `${chapterNum}. ${f.title}`, id: chId })
    md += `${f.description}\n\n`

    for (let i = 0; i < f.sections.length; i++) {
      const sec = f.sections[i]
      const secId = headingId(`ch${chapterNum}-s${i + 1}`)
      md += `### <a id="${secId}"></a>${chapterNum}.${i + 1} ${sec.title}\n\n`
      headings.push({ level: 3, text: `${chapterNum}.${i + 1} ${sec.title}`, id: secId })
      if (sec.description) md += `> ${sec.description}\n\n`

      const docId = `${f.id}/${sec.key}`
      const content = getDocumentContent(docId)
      const resolved = resolveCrossReferences(content, chapterMap)
      md += resolved ? `${resolved}\n\n` : `> *（本章节暂未编写）*\n\n`
    }

    chapterNum++
  }

  const catalogRow = catalog as Omit<CatalogRow, 'targets' | 'cover_info' | 'features'>
  return {
    catalog: { ...catalogRow, targets, coverInfo },
    features,
    markdown: md,
    headings,
  }
}

function headingId(base: string): string {
  return base.toLowerCase().replace(/\s+/g, '-')
}

function getDocumentContent(docId: string): string {
  const db = getDb()
  const updates = db.prepare(
    'SELECT update_data FROM document_updates WHERE document_id = ? ORDER BY id ASC',
  ).all(docId) as UpdateRow[]

  if (updates.length === 0) {
    const snapshot = db.prepare(
      'SELECT snapshot_data FROM document_snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 1',
    ).get(docId) as SnapshotRow | undefined

    if (!snapshot) return ''

    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(snapshot.snapshot_data))
    return doc.getText('content').toString()
  }

  const doc = new Y.Doc()
  for (const row of updates) {
    Y.applyUpdate(doc, new Uint8Array(row.update_data))
  }
  return doc.getText('content').toString()
}

function resolveCrossReferences(
  html: string,
  chapterMap: Map<string, {
    num: number
    anchorId: string
    title: string
    sections: Record<string, { anchorId: string; title: string }>
  }>,
): string {
  if (!html) return html
  // 匹配 <crossref> 标签，兼容 data-feature-id（新格式）和 featureid / featureId（旧格式）
  return html.replace(
    /<crossref\s+[^>]*(?:data-feature-id|featureid|featureId)="([^"]+)"[^>]*>(?:[^<]*)<\/crossref>/gi,
    (_match, featureId: string) => {
      // 从完整匹配中提取 sectionKey（兼容新 data-section-key 和旧 sectionkey / sectionKey）
      const sectionMatch = _match.match(/(?:data-section-key|sectionkey|sectionKey)="([^"]*)"/i)
      const sectionKey = sectionMatch ? sectionMatch[1] : ''
      const info = chapterMap.get(featureId)
      if (!info) {
        return '→ 参见：*（未收录）*'
      }
      if (sectionKey && info.sections[sectionKey]) {
        const sec = info.sections[sectionKey]
        return `→ 参见：[第 ${info.num} 章 ${info.title} › ${sec.title}](#${sec.anchorId})`
      }
      return `→ 参见：[第 ${info.num} 章 ${info.title}](#${info.anchorId})`
    },
  )
}

export function generateHtml(manual: ManualResult | null): string | null {
  if (!manual) return null

  let bodyHtml = markdownToHtml(manual.markdown)
  bodyHtml = embedImages(bodyHtml)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${manual.catalog.title}</title>
  <style>
    @page { size: A4; margin: 2cm 2.5cm; }
    body {
      font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
      font-size: 14px;
      line-height: 1.8;
      color: #333;
      overflow-wrap: break-word;
      word-break: break-all;
    }
    h1 { font-size: 28px; text-align: center; margin: 60px 0 20px; page-break-before: avoid; }
    h2 { font-size: 20px; margin: 30px 0 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; page-break-before: always; }
    h3 { font-size: 16px; margin: 20px 0 10px; }
    blockquote { border-left: 3px solid #d1d5db; padding-left: 16px; color: #6b7280; margin: 10px 0; overflow-wrap: break-word; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; table-layout: fixed; overflow-wrap: break-word; }
    th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; overflow-wrap: break-word; }
    th { background: #f3f4f6; font-weight: 600; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; word-break: break-all; }
    pre { background: #1f2937; color: #f9fafb; padding: 16px; border-radius: 8px; font-size: 13px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    pre code { background: none; padding: 0; color: inherit; white-space: pre-wrap; }
    img { max-width: 100%; border-radius: 8px; }
    a { color: #2563eb; text-decoration: none; }
    /* 待办清单（与编辑器保持一致） */
    ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.4em; margin: 3px 0; }
    ul[data-type="taskList"] li > label { flex-shrink: 0; display: flex; align-items: center; min-height: 1.8em; }
    ul[data-type="taskList"] li > label input[type="checkbox"] { width: 14px; height: 14px; margin: 0; accent-color: #3b82f6; }
    ul[data-type="taskList"] li[data-checked="true"] > div > p { text-decoration: line-through; color: #9ca3af; }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`
}

function embedImages(html: string): string {
  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'data/uploads/images')
  return html.replace(/<img[^>]+src="(\/uploads\/images\/[^"]+)"[^>]*>/g, (match, src) => {
    const filename = src.replace(/^\/uploads\/images\//, '')
    const filepath = join(uploadDir, filename)
    if (existsSync(filepath)) {
      try {
        const data = readFileSync(filepath)
        const base64 = data.toString('base64')
        const mime = getMime(filename)
        return match.replace(src, `data:${mime};base64,${base64}`)
      } catch { /* 读取失败 */ }
    }
    return match
  })
}

function getMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
  return map[ext || ''] || 'image/png'
}

function markdownToHtml(md: string): string {
  let html = md
    // 修复协议相对 URL
    .replace(/src="\/\//g, 'src="https://')
    // 兜底：处理未被 resolveCrossReferences 解析的原始 <crossref> 标签（兼容历史数据）
    .replace(/<crossref\s+[^>]*(?:data-feature-id|featureid|featureId)="([^"]+)"[^>]*>(?:[^<]*)<\/crossref>/gi,
      (_match, featureId: string) => {
        const labelMatch = _match.match(/(?:data-label|label)="([^"]*)"/i)
        const label = labelMatch?.[1] || featureId
        return `<a href="#feature-${featureId}" style="color:#2563eb;background:#eff6ff;padding:0.1em 0.4em;border-radius:0.25em;text-decoration:none;">→ 参见：${label}</a>`
      })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>')

  html = '<p>' + html + '</p>'
  html = html.replace(/<p><h([1-4])>/g, '<h$1>').replace(/<\/h([1-4])><\/p>/g, '</h$1>')
  html = html.replace(/<p><hr><\/p>/g, '<hr>')
  html = html.replace(/<p><blockquote>/g, '<blockquote>').replace(/<\/blockquote><\/p>/g, '</blockquote>')
  // 移除编辑器 HTML 块级元素外层的 <p> 包裹（ul/ol/pre 等）
  html = html.replace(/<p><(ul|ol|pre)\b/g, '<$1').replace(/<\/(ul|ol|pre)>\s*<\/p>/g, '</$1>')

  return html
}

export async function addPdfOutline(pdfBuffer: Buffer, headings: HeadingEntry[]): Promise<Buffer> {
  if (headings.length === 0) return pdfBuffer

  const pdfDoc = await PDFDocument.load(pdfBuffer)
  const pages = pdfDoc.getPages()
  const ctx = pdfDoc.context as PDFContextLike

  const outlinesDict = ctx.obj({ Type: 'Outlines' })
  const outlinesRef = ctx.register(outlinesDict)

  let currentPage = 2 // 封面 p1，目录 p2
  const items: Array<{ ref: PDFRef; level: number }> = []
  let lastH2Ref: PDFRef | null = null
  const h2Children: PDFRef[] = []

  function finishH2() {
    if (!lastH2Ref || h2Children.length === 0) return
    const d = ctx.lookup(lastH2Ref) as PDFDict | undefined
    if (!d) return
    d.set(PDFName.of('First'), h2Children[0])
    d.set(PDFName.of('Last'), h2Children[h2Children.length - 1])
    d.set(PDFName.of('Count'), pdfDoc.context.obj(-h2Children.length))
    for (let ci = 0; ci < h2Children.length; ci++) {
      const cd = ctx.lookup(h2Children[ci]) as PDFDict | undefined
      if (!cd) continue
      if (ci > 0) cd.set(PDFName.of('Prev'), h2Children[ci - 1])
      if (ci < h2Children.length - 1) cd.set(PDFName.of('Next'), h2Children[ci + 1])
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    if (h.level === 2 && i > 0) {
      currentPage++
      finishH2()
      h2Children.length = 0
    }
    const pageIndex = Math.max(0, Math.min(currentPage - 1, pages.length - 1))

    let hex = 'FEFF'
    for (let ci = 0; ci < h.text.length; ci++) {
      const code = h.text.charCodeAt(ci)
      hex += ((code >> 8) & 0xFF).toString(16).padStart(2, '0')
      hex += (code & 0xFF).toString(16).padStart(2, '0')
    }

    const entry: Record<string, unknown> = {
      Title: PDFHexString.of(hex),
      Dest: [pages[pageIndex].ref, 'XYZ', null, null, null],
    }

    if (h.level === 2) {
      entry.Parent = outlinesRef
      lastH2Ref = ctx.register(ctx.obj(entry))
      items.push({ ref: lastH2Ref, level: 2 })
    } else {
      entry.Parent = lastH2Ref || outlinesRef
      const ref = ctx.register(ctx.obj(entry))
      items.push({ ref, level: 3 })
      h2Children.push(ref)
    }
  }
  finishH2()

  // outlines root 链表
  if (items.length > 0) {
    const rootDict = ctx.lookup(outlinesRef) as PDFDict | undefined
    const topItems = items.filter(it => it.level === 2)
    if (rootDict && topItems.length > 0) {
      rootDict.set(PDFName.of('First'), topItems[0].ref)
      rootDict.set(PDFName.of('Last'), topItems[topItems.length - 1].ref)
      for (let ti = 0; ti < topItems.length; ti++) {
        const td = ctx.lookup(topItems[ti].ref) as PDFDict | undefined
        if (!td) continue
        if (ti > 0) td.set(PDFName.of('Prev'), topItems[ti - 1].ref)
        if (ti < topItems.length - 1) td.set(PDFName.of('Next'), topItems[ti + 1].ref)
      }
      rootDict.set(PDFName.of('Count'), pdfDoc.context.obj(items.length))
    }
  }

  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef)

  const result = await pdfDoc.save()
  return Buffer.from(result)
}
