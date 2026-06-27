/**
 * PDF 导出服务
 *
 * 管道：ManualResult → markdown-it (HTML) → 图片内联 → Puppeteer (PDF) → pdf-lib (书签) → Buffer
 *
 * 复用 manual-assembler.ts 的 assembleManual() 输出，
 * 遵循 markdown-export.ts 的服务层模式。
 */
import { readFileSync, existsSync, mkdirSync, createWriteStream } from 'fs'
import { join } from 'path'
import { config } from '../config.js'
import MarkdownIt from 'markdown-it'
import { getOrFetch } from './remote-cache.js'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ManualResult, HeadingEntry } from '../types.js'

// ================ 常量 ========================================================

/** A4 PDF 内容区宽度（96 DPI px）：210mm - 2.5cm左右边距 = 160mm ≈ 605px */
const PDF_CONTENT_WIDTH = Math.round((210 - 25 - 25) * 96 / 25.4)

/** 中文字体 CSS @font-face 声明 */
function getFontCss(): string {
  const regular = config.pdfFontRegular
  const bold = config.pdfFontBold
  if (regular) {
    const regularUrl = `file:///${regular.replace(/\\/g, '/')}`
    const boldCss = bold
      ? `@font-face { font-family: 'Noto Sans SC'; src: url('file:///${bold.replace(/\\/g, '/')}'); font-weight: 700; }`
      : ''
    return `@font-face { font-family: 'Noto Sans SC'; src: url('${regularUrl}'); }${boldCss}`
  }
  // 回退：尝试 data/fonts/ 目录
  const fontDir = join(process.cwd(), 'data', 'fonts')
  const regularPath = join(fontDir, 'NotoSansSC-Regular.ttf')
  const boldPath = join(fontDir, 'NotoSansSC-Bold.ttf')
  let css = ''
  if (existsSync(regularPath)) {
    css += `@font-face { font-family: 'Noto Sans SC'; src: url('file:///${regularPath.replace(/\\/g, '/')}'); }`
  }
  if (existsSync(boldPath)) {
    css += `@font-face { font-family: 'Noto Sans SC'; src: url('file:///${boldPath.replace(/\\/g, '/')}'); font-weight: 700; }`
  }
  return css
}

// ================ Markdown → HTML ============================================

const md = new MarkdownIt({
  html: true,       // 保留来自 TipTap 编辑器的内联 HTML
  linkify: true,
  breaks: false,
})

/** 将 ManualResult.markdown 转换为完整的 A4 排版 HTML 页面 */
async function generateHtml(manual: ManualResult, fontCss: string): Promise<string> {
  let bodyHtml = md.render(manual.markdown)
  bodyHtml = embedLocalImages(bodyHtml)
  bodyHtml = await embedRemoteImages(bodyHtml)
  bodyHtml = replaceVideosForPdf(bodyHtml)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(manual.catalog.title)}</title>
  <style>
    ${fontCss}
    body {
      font-family: "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
      font-size: 14px;
      line-height: 1.8;
      color: #333;
      overflow-wrap: break-word;
      word-break: break-all;
    }
    h1 { font-size: 28px; text-align: center; margin: 60px 0 20px; page-break-before: avoid; }
    h2 { font-size: 20px; margin: 30px 0 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    h3 { font-size: 16px; margin: 20px 0 10px; }
    h4 { font-size: 15px; margin: 15px 0 8px; }
    blockquote { border-left: 3px solid #d1d5db; padding-left: 16px; color: #6b7280; margin: 10px 0; overflow-wrap: break-word; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; table-layout: fixed; overflow-wrap: break-word; }
    th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; overflow-wrap: break-word; }
    th { background: #f3f4f6; font-weight: 600; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; word-break: break-all; }
    pre { background: #1f2937; color: #f9fafb; padding: 16px; border-radius: 8px; font-size: 13px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    pre code { background: none; padding: 0; color: inherit; white-space: pre-wrap; }
    img { max-width: 100%; border-radius: 8px; }
    a { color: #2563eb; text-decoration: none; }
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

// ================ 图片处理 ====================================================

/** 将本地 /uploads/ 图片转换为 base64 data URI */
function embedLocalImages(html: string): string {
  const uploadDir = config.uploadDir
  return html.replace(/<img[^>]+src="(\/uploads\/images\/[^"]+)"[^>]*>/g, (match, src: string) => {
    const filename = src.replace(/^\/uploads\/images\//, '')
    // 也尝试 videos 目录
    const candidates = [
      join(uploadDir, 'images', filename),
      join(uploadDir, filename),
    ]
    for (const filepath of candidates) {
      if (existsSync(filepath)) {
        try {
          const data = readFileSync(filepath)
          const base64 = data.toString('base64')
          const mime = getMime(filename)
          return match.replace(src, `data:${mime};base64,${base64}`)
        } catch { /* 读取失败，继续尝试下一个路径 */ }
      }
    }
    return match
  })
}

/** 将远程 http(s):// 图片通过缓存层下载并转换为 base64 data URI */
async function embedRemoteImages(html: string): Promise<string> {
  // 收集所有远程图片 URL
  const remoteRe = /<img[^>]+src="(https?:\/\/[^"]+)"[^>]*>/gi
  const urls = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = remoteRe.exec(html)) !== null) {
    urls.add(m[1])
  }

  if (urls.size === 0) return html

  // 并行获取所有远程图片（通过缓存层）
  const cacheMap = new Map<string, string | null>()
  const fetches = [...urls].map(async (url) => {
    try {
      const cached = await getOrFetch(url)
      if (cached) {
        const data = readFileSync(cached.filepath)
        const base64 = data.toString('base64')
        cacheMap.set(url, `data:${cached.mimeType};base64,${base64}`)
      } else {
        // 缓存层失败，尝试直接 fetch 降级
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer())
            const base64 = buf.toString('base64')
            const mime = res.headers.get('content-type') || 'image/png'
            cacheMap.set(url, `data:${mime};base64,${base64}`)
          } else {
            cacheMap.set(url, null)
          }
        } catch {
          cacheMap.set(url, null)
        }
      }
    } catch {
      cacheMap.set(url, null)
    }
  })
  await Promise.all(fetches)

  // 替换 URL 为 base64
  let result = html
  for (const [url, dataUri] of cacheMap) {
    if (!dataUri) continue
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`src="${escaped}"`, 'g'), `src="${dataUri}"`)
  }

  return result
}

function getMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp',
  }
  return map[ext || ''] || 'image/png'
}

// ================ 视频处理 ===================================================

/** PDF 中无法嵌入视频，替换为占位提示 */
function replaceVideosForPdf(html: string): string {
  return html.replace(
    /<video[^>]*>[\s\S]*?<\/video>/gi,
    '<div style="border:2px dashed #d1d5db;border-radius:8px;padding:48px 16px;text-align:center;color:#9ca3af;margin:16px 0;">视频内容，请查看在线版本</div>',
  )
}

// ================ 字体 ========================================================

/** 确保中文字体可用：优先配置路径 → data/fonts/ → 自动下载 */
async function ensureFont(): Promise<void> {
  if (config.pdfFontRegular) return // 已配置

  const fontDir = join(process.cwd(), 'data', 'fonts')
  const regularPath = join(fontDir, 'NotoSansSC-Regular.ttf')

  if (existsSync(regularPath)) return // 已存在

  // 尝试自动下载
  try {
    mkdirSync(fontDir, { recursive: true })
    const url = 'https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return
    const buffer = Buffer.from(await res.arrayBuffer())
    const ws = createWriteStream(regularPath)
    await new Promise<void>((resolve, reject) => {
      ws.write(buffer, err => err ? reject(err) : resolve())
      ws.end()
    })
  } catch {
    // 下载失败，降级为系统默认字体
  }
}

// ================ Puppeteer PDF 生成 =========================================

interface PdfOptions {
  headerText?: string
  footerText?: string
}

/** 主函数：从 ManualResult 生成 PDF Buffer */
export async function buildPdf(manual: ManualResult, opts: PdfOptions = {}): Promise<Buffer> {
  await ensureFont()
  const fontCss = getFontCss()
  const html = await generateHtml(manual, fontCss)
  const puppeteer = await import('puppeteer')

  const launchOpts: Record<string, unknown> = {
    headless: true,
    args: process.platform === 'linux'
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
      : [],
  }
  if (config.puppeteerExecutablePath) {
    launchOpts.executablePath = config.puppeteerExecutablePath
  }

  const browser = await puppeteer.launch(launchOpts)
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: PDF_CONTENT_WIDTH, height: 50000, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {})
    // 等待所有图片加载完成
    await page.evaluate(`new Promise(resolve => {
      const imgs = Array.from(document.images).filter(i => !i.complete)
      if (imgs.length === 0) return resolve()
      let pending = imgs.length
      imgs.forEach(i => { i.onload = i.onerror = () => { pending--; if (pending === 0) resolve() } })
      setTimeout(resolve, 10000)
    })`).catch(() => {})

    // 步骤 1：生成 PDF
    const headerText = opts.headerText || manual.catalog.title
    const footerText = opts.footerText || ''

    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '2cm', bottom: '2cm', left: '2.5cm', right: '2.5cm' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:10px;text-align:center;width:100%;color:#9ca3af;">${escapeHtml(headerText)}</div>`,
      footerTemplate: `<div style="font-size:10px;text-align:center;width:100%;color:#9ca3af;">${escapeHtml(footerText)}${footerText ? ' · ' : ''}第 <span class="pageNumber"></span> 页 / <span class="totalPages"></span> 页</div>`,
    })

    // 步骤 2：用 pdfjs-dist 解析 PDF 内容流，直接确定每个标题所在页码（100% 准确）
    let pdfBuffer: Buffer = Buffer.from(pdf)
    try {
      if (manual.headings.length > 0) {
        const headingPageMap = await findHeadingPages(pdfBuffer, manual.headings)
        if (headingPageMap.size > 0) {
          pdfBuffer = await addPdfOutline(pdfBuffer, manual.headings, headingPageMap)
        }
      }
    } catch (outlineErr: unknown) {
      // 书签注入失败不阻塞导出，仅记录日志
      const msg = outlineErr instanceof Error ? outlineErr.message : String(outlineErr)
      console.error('PDF outline failed:', msg)
    }

    return pdfBuffer
  } finally {
    await browser.close()
  }
}

// ================ PDF 标题页码检测 ===========================================

/** pdfjs TextItem 最小接口 */
interface PdfTextItem {
  str: string
}

/**
 * 文本归一化：
 *   1. NFKC 消除 CJK 兼容汉字码点差异（⻜→飞）
 *   2. 全角句号 → 半角句号（U+FF0E→U+002E），解决 PDF 字体渲染差异
 *   3. 不换行空格/全角空格 → 普通空格
 */

function normalizeText(text: string): string {
  // 用 fromCharCode 构造正则，避免源文件中的 literal irregular whitespace
  const wsRe = new RegExp(`[${String.fromCharCode(0x00A0)}${String.fromCharCode(0x3000)}]`, 'g')
  return text
    .normalize('NFKC')
    .replace(/．/g, '.')
    .replace(wsRe, ' ')
}

/**
 * 用 pdfjs-dist 解析 PDF 内容流，直接在每一页的文字中搜索标题文本，
 * 确定每个标题落在哪一页（0-based）。不依赖任何坐标估算。
 *
 * 每个标题在所有页面中取最后一次匹配（TOC 在前、正文在后 = 最后=正文页）。
 */
async function findHeadingPages(
  pdfBuffer: Buffer,
  headings: HeadingEntry[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()

  const targets = headings
    .map(h => ({ id: h.id, text: normalizeText(h.text.trim()) }))
    .filter(h => h.text.length > 0)

  if (targets.length === 0) return map

  const doc = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise

  // 逐页提取并归一化文本
  const pageTexts: string[] = []
  for (let pageIdx = 0; pageIdx < doc.numPages; pageIdx++) {
    const page = await doc.getPage(pageIdx + 1)
    const content = await page.getTextContent()
    pageTexts.push(
      normalizeText(
        content.items.map((item) => (item as PdfTextItem).str).join(''),
      ),
    )
  }

  // 每个标题在所有页面中取最后一次匹配（TOC 在前、正文在后 → 最后=正文页）
  for (const t of targets) {
    let lastHit = -1
    for (let pageIdx = 0; pageIdx < pageTexts.length; pageIdx++) {
      if (pageTexts[pageIdx].includes(t.text)) {
        lastHit = pageIdx
      }
    }
    if (lastHit >= 0) {
      map.set(t.id, lastHit)
    }
  }

  return map
}

// ================ PDF 书签（Outline）注入 =====================================

/** pdf-lib context API 未完整导出类型，用最小接口约束 */
interface PDFContextLike {
  obj: (init: Record<string, unknown>) => import('pdf-lib').PDFDict
  register: (obj: import('pdf-lib').PDFObject) => import('pdf-lib').PDFRef
  lookup: (ref: import('pdf-lib').PDFRef) => import('pdf-lib').PDFObject | undefined
}

/** 向 PDF Buffer 注入书签（Outline），支持两层嵌套 + 中文标题 */
async function addPdfOutline(
  pdfBuffer: Buffer,
  headings: HeadingEntry[],
  headingPageMap?: Map<string, number>,
): Promise<Buffer> {
  if (headings.length === 0) return pdfBuffer

  const { PDFDocument, PDFHexString, PDFName } = await import('pdf-lib')
  const pdfDoc = await PDFDocument.load(pdfBuffer)
  const pages = pdfDoc.getPages()
  const ctx = pdfDoc.context as PDFContextLike

  const outlinesDict = ctx.obj({ Type: 'Outlines' })
  const outlinesRef = ctx.register(outlinesDict)

  let currentPage = 2 // 封面 p1，目录 p2（fallback，仅 headingPageMap 缺失时使用）
  const items: Array<{ ref: import('pdf-lib').PDFRef; level: number }> = []
  let lastH2Ref: import('pdf-lib').PDFRef | null = null
  const h2Children: import('pdf-lib').PDFRef[] = []

  function getPageIndex(h: HeadingEntry, i: number): number {
    if (headingPageMap?.has(h.id)) {
      return headingPageMap.get(h.id)!
    }
    // fallback：无 headingPageMap 时按递增估算
    if (i > 0) currentPage++
    return Math.max(0, Math.min(currentPage - 1, pages.length - 1))
  }

  function finishH2() {
    if (!lastH2Ref || h2Children.length === 0) return
    const d = ctx.lookup(lastH2Ref) as import('pdf-lib').PDFDict | undefined
    if (!d) return
    d.set(PDFName.of('First'), h2Children[0])
    d.set(PDFName.of('Last'), h2Children[h2Children.length - 1])
    d.set(PDFName.of('Count'), pdfDoc.context.obj(-h2Children.length))
    for (let ci = 0; ci < h2Children.length; ci++) {
      const cd = ctx.lookup(h2Children[ci]) as import('pdf-lib').PDFDict | undefined
      if (!cd) continue
      if (ci > 0) cd.set(PDFName.of('Prev'), h2Children[ci - 1])
      if (ci < h2Children.length - 1) cd.set(PDFName.of('Next'), h2Children[ci + 1])
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    if (h.level === 2 && i > 0) {
      finishH2()
      h2Children.length = 0
    }
    const pageIndex = getPageIndex(h, i)

    // UTF-16 BE 编码中文标题
    let hex = 'FEFF' // BOM
    for (let ci = 0; ci < h.text.length; ci++) {
      const code = h.text.charCodeAt(ci)
      hex += ((code >> 8) & 0xFF).toString(16).padStart(2, '0')
      hex += (code & 0xFF).toString(16).padStart(2, '0')
    }

    const entry: Record<string, unknown> = {
      Title: PDFHexString.of(hex),
      Dest: [pages[pageIndex].ref, 'XYZ', null, null, null],
    }

    if (h.level <= 2) {
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
    const rootDict = ctx.lookup(outlinesRef) as import('pdf-lib').PDFDict | undefined
    const topItems = items.filter(it => it.level === 2)
    if (rootDict && topItems.length > 0) {
      rootDict.set(PDFName.of('First'), topItems[0].ref)
      rootDict.set(PDFName.of('Last'), topItems[topItems.length - 1].ref)
      for (let ti = 0; ti < topItems.length; ti++) {
        const td = ctx.lookup(topItems[ti].ref) as import('pdf-lib').PDFDict | undefined
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

// ================ 工具函数 ===================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
