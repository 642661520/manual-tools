import { readFileSync } from 'fs'
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getDb } from '../../db/index.js'
import { yjsDataToHtml } from '../../lib/yjs-utils.js'
import { isCatalogPart } from '../../types.js'
import type {
  CatalogRow,
  CatalogFeatureEntry,
  CatalogEntry,
  FeatureRow,
  FeatureData,
  ManualResult,
  SnapshotRow,
  UpdateRow,
  HeadingEntry,
} from '../../types.js'
import { buildSidebarHtml } from './sidebar.js'
import {
  buildCoverContentHtml,
  buildChapterContentHtml,
  buildTocHtml,
  processContentHeadings,
} from './content.js'
import { buildSearchIndex } from './search.ts'
import type { SitePage, PartMeta } from './shared.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 启动时读取静态资源，避免每次构建都读盘
const TEMPLATE = readFileSync(join(__dirname, 'template.html'), 'utf-8')
const STYLES = readFileSync(join(__dirname, 'style.css'), 'utf-8')
const SCRIPTS_JS = readFileSync(join(__dirname, 'script.js'), 'utf-8')
const SEARCH_JS = readFileSync(join(__dirname, 'search.js'), 'utf-8')

/** 构建静态文档站点，返回输出目录路径 */
export async function buildStaticSite(
  catalogId: string,
  versionLabel: string,
): Promise<string | null> {
  const manual = assembleManualForSite(catalogId)
  if (!manual) return null

  const catalogTitle = manual.catalog.title
  const outDir = join(process.cwd(), 'data/docs', catalogId, versionLabel)

  // 从 manual 中提取 parts 信息
  const manualExt = manual as ManualResult & { parts: PartMeta[]; hasParts: boolean }
  const parts = manualExt.parts || []
  const hasParts = manualExt.hasParts || false

  // 收集所有 section 的 HTML 内容，按章节分组，同时处理 heading id
  const chapterPages: Map<number, SitePage[]> = new Map()
  let chNum = 1
  for (const f of manual.features) {
    const pages: SitePage[] = []
    let secNum = 1
    for (const sec of f.sections) {
      const docId = `${f.id}/${sec.key}`
      const rawContent = getDocumentContent(docId)
      if (!rawContent) {
        secNum++
        continue
      }
      // 注入 heading id 以支持 TOC 锚点
      const { html: content } = processContentHeadings(rawContent)
      pages.push({
        id: `ch${chNum}-s${secNum}`,
        title: `${chNum}.${secNum} ${f.title} > ${sec.title}`,
        content,
      })
      secNum++
    }
    chapterPages.set(chNum, pages)
    chNum++
  }

  const totalChapters = chNum - 1
  const features = manual.features

  await mkdir(outDir, { recursive: true })

  // ----- 封面页 -----
  const coverSidebarHtml = buildSidebarHtml(features, parts, hasParts, 0)
  const coverContentHtml = buildCoverContentHtml(features, parts, hasParts, catalogTitle)
  const coverPageHtml = wrapTemplate({
    catalogId,
    title: catalogTitle,
    versionLabel,
    sidebarHtml: coverSidebarHtml,
    contentHtml: coverContentHtml,
    tocHtml: '', // 封面页不显示右侧 TOC
    currentChapter: 0,
    pageTitle: catalogTitle,
  })
  await writeFile(join(outDir, 'index.html'), coverPageHtml, 'utf-8')

  // ----- 每章一页 -----
  const allFeatures = manual.features
  chNum = 1
  for (const f of allFeatures) {
    const pages = chapterPages.get(chNum) || []
    const chSidebarHtml = buildSidebarHtml(features, parts, hasParts, chNum)
    const chContentHtml = buildChapterContentHtml(f, chNum, pages, parts, hasParts, totalChapters)
    const tocHtml = buildTocHtml(f, chNum, pages)
    const filename = `ch${String(chNum).padStart(2, '0')}.html`
    const chPageHtml = wrapTemplate({
      catalogId,
      title: catalogTitle,
      versionLabel,
      sidebarHtml: chSidebarHtml,
      contentHtml: chContentHtml,
      tocHtml,
      currentChapter: chNum,
      pageTitle: `${chNum}. ${f.title} - ${catalogTitle}`,
    })
    await writeFile(join(outDir, filename), chPageHtml, 'utf-8')
    chNum++
  }

  // ----- 搜索索引 -----
  const searchIndex = buildSearchIndex(features, chapterPages)
  await writeFile(join(outDir, 'search-index.json'), JSON.stringify(searchIndex), 'utf-8')

  return outDir
}

function assembleManualForSite(catalogId: string): ManualResult | null {
  const db = getDb()
  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(catalogId) as
    | CatalogRow
    | undefined
  if (!catalog) return null

  const entries: CatalogEntry[] = JSON.parse(catalog.features)
  const targets: string[] = JSON.parse(catalog.targets)
  const coverInfo = JSON.parse(catalog.cover_info || '{}')

  // 展平 entries
  const flatFeatureEntries: CatalogFeatureEntry[] = []
  const parts: PartMeta[] = []
  let partIdx = 0
  for (const entry of entries) {
    if (isCatalogPart(entry)) {
      partIdx++
      const partFeatureIds: string[] = []
      for (const fe of entry.features) {
        flatFeatureEntries.push(fe)
        partFeatureIds.push(fe.featureId)
      }
      parts.push({ title: entry.title, idx: partIdx, featureIds: partFeatureIds })
    } else {
      flatFeatureEntries.push(entry)
    }
  }
  const hasParts = parts.length > 0

  const features: FeatureData[] = []
  for (const fe of flatFeatureEntries) {
    const f = db.prepare('SELECT * FROM features WHERE id = ?').get(fe.featureId) as
      | FeatureRow
      | undefined
    if (!f) continue
    const rawSections = JSON.parse(f.sections || '[]') as {
      key: string
      title: string
      description?: string
    }[]
    const source = rawSections.length > 0 ? rawSections : [{ key: '_default', title: f.title }]
    const ordered = fe.sectionOrder
      ? (fe.sectionOrder
          .map((k) => source.find((s) => s.key === k))
          .filter(Boolean) as typeof source)
      : source

    features.push({ id: f.id, title: f.title, description: f.description, sections: ordered })
  }

  return {
    catalog: { ...catalog, targets, coverInfo, entries },
    features,
    markdown: '',
    headings: [] as HeadingEntry[],
    parts,
    hasParts,
  } as ManualResult & { parts: PartMeta[]; hasParts: boolean }
}

function getDocumentContent(docId: string): string {
  const db = getDb()
  const updates = db
    .prepare('SELECT update_data FROM document_updates WHERE document_id = ? ORDER BY id ASC')
    .all(docId) as UpdateRow[]

  const snapshot = db
    .prepare(
      'SELECT snapshot_data FROM document_snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(docId) as SnapshotRow | undefined

  if (updates.length === 0 && !snapshot) return ''

  return yjsDataToHtml(
    snapshot?.snapshot_data ?? null,
    updates.map((u) => u.update_data),
  )
}

function wrapTemplate(params: {
  catalogId: string
  title: string
  versionLabel: string
  sidebarHtml: string
  contentHtml: string
  tocHtml: string
  currentChapter: number
  pageTitle: string
}): string {
  const scripts =
    SCRIPTS_JS.replaceAll('{{CATALOG_ID}}', params.catalogId)
      .replaceAll('{{CURRENT_CHAPTER}}', String(params.currentChapter))
      .replaceAll('{{VERSION_LABEL}}', params.versionLabel) +
    '\n' +
    SEARCH_JS

  return (
    TEMPLATE.replaceAll('{{CATALOG_ID}}', params.catalogId)
      .replaceAll('{{TITLE}}', params.title)
      .replaceAll('{{VERSION_LABEL}}', params.versionLabel)
      .replaceAll('{{VERSION}}', params.versionLabel)
      .replaceAll('{{CURRENT_CHAPTER}}', String(params.currentChapter))
      .replaceAll('{{PAGE_TITLE}}', params.pageTitle)
      .replaceAll('{{STYLES}}', STYLES)
      .replaceAll('{{SIDEBAR}}', params.sidebarHtml)
      .replaceAll('{{CONTENT}}', params.contentHtml)
      .replaceAll('{{TOC}}', params.tocHtml)
      // 使用 split/join 避免 $& 等特殊替换模式被错误解释
      .split('{{SCRIPTS}}')
      .join(scripts)
  )
}

export type { SitePage }
