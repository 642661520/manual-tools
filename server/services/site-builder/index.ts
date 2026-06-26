import { readFileSync } from 'fs'
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getDb } from '../../db/index.js'
import * as Y from 'yjs'
import { isCatalogPart } from '../../types.js'
import type { CatalogRow, CatalogFeatureEntry, CatalogEntry, FeatureRow, FeatureData, ManualResult, SnapshotRow, UpdateRow, HeadingEntry } from '../../types.js'
import { buildSidebarHtml } from './sidebar.js'
import { buildCoverContentHtml, buildChapterContentHtml } from './content.js'
import type { SitePage, PartMeta } from './shared.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 启动时读取静态资源，避免每次构建都读盘
const TEMPLATE = readFileSync(join(__dirname, 'template.html'), 'utf-8')
const STYLES = readFileSync(join(__dirname, 'style.css'), 'utf-8')
const SCRIPTS_TEMPLATE = readFileSync(join(__dirname, 'script.js'), 'utf-8')

/** 构建静态文档站点，返回输出目录路径 */
export async function buildStaticSite(catalogId: string, versionLabel: string): Promise<string | null> {
  const manual = assembleManualForSite(catalogId)
  if (!manual) return null

  const catalogTitle = manual.catalog.title
  const outDir = join(process.cwd(), 'data/docs', catalogId, versionLabel)

  // 从 manual 中提取 parts 信息
  const manualExt = manual as ManualResult & { parts: PartMeta[]; hasParts: boolean }
  const parts = manualExt.parts || []
  const hasParts = manualExt.hasParts || false

  // 收集所有 section 的 HTML 内容，按章节分组
  const chapterPages: Map<number, SitePage[]> = new Map()
  let chNum = 1
  for (const f of manual.features) {
    const pages: SitePage[] = []
    let secNum = 1
    for (const sec of f.sections) {
      const docId = `${f.id}/${sec.key}`
      const content = getDocumentContent(docId)
      if (!content) { secNum++; continue }
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

  // 封面页 sidebar + content
  const coverSidebarHtml = buildSidebarHtml(features, parts, hasParts, 0)
  const coverContentHtml = buildCoverContentHtml(features, parts, hasParts, catalogTitle)
  const coverPageHtml = wrapTemplate({
    catalogId, title: catalogTitle, versionLabel,
    sidebarHtml: coverSidebarHtml,
    contentHtml: coverContentHtml,
    currentChapter: 0,
    pageTitle: catalogTitle,
  })

  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'index.html'), coverPageHtml, 'utf-8')

  // 每章一页
  const allFeatures = manual.features
  chNum = 1
  for (const f of allFeatures) {
    const pages = chapterPages.get(chNum) || []
    const chSidebarHtml = buildSidebarHtml(features, parts, hasParts, chNum)
    const chContentHtml = buildChapterContentHtml(f, chNum, pages, parts, hasParts, totalChapters)
    const filename = `ch${String(chNum).padStart(2, '0')}.html`
    const chPageHtml = wrapTemplate({
      catalogId, title: catalogTitle, versionLabel,
      sidebarHtml: chSidebarHtml,
      contentHtml: chContentHtml,
      currentChapter: chNum,
      pageTitle: `${chNum}. ${f.title} - ${catalogTitle}`,
    })
    await writeFile(join(outDir, filename), chPageHtml, 'utf-8')
    chNum++
  }

  return outDir
}

function assembleManualForSite(catalogId: string): ManualResult | null {
  const db = getDb()
  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(catalogId) as CatalogRow | undefined
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
    const f = db.prepare('SELECT * FROM features WHERE id = ?').get(fe.featureId) as FeatureRow | undefined
    if (!f) continue
    const rawSections = JSON.parse(f.sections || '[]') as { key: string; title: string; description?: string }[]
    const source = rawSections.length > 0 ? rawSections : [{ key: '_default', title: f.title }]
    const ordered = fe.sectionOrder
      ? fe.sectionOrder.map(k => source.find(s => s.key === k)).filter(Boolean) as typeof source
      : source

    features.push({ id: f.id, title: f.title, description: f.description, sections: ordered })
  }

  return {
    catalog: { ...catalog, targets, coverInfo, entries },
    features,
    markdown: '',
    headings: [] as HeadingEntry[],
    // 扩展字段：通过 ManualResult 的额外属性传递 part 信息
    parts,
    hasParts,
  } as ManualResult & { parts: PartMeta[]; hasParts: boolean }
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

function wrapTemplate(params: {
  catalogId: string
  title: string
  versionLabel: string
  sidebarHtml: string
  contentHtml: string
  currentChapter: number
  pageTitle: string
}): string {
  const scripts = SCRIPTS_TEMPLATE
    .replaceAll('{{CATALOG_ID}}', params.catalogId)
    .replaceAll('{{CURRENT_CHAPTER}}', String(params.currentChapter))
    .replaceAll('{{VERSION_LABEL}}', params.versionLabel)

  return TEMPLATE
    .replaceAll('{{CATALOG_ID}}', params.catalogId)
    .replaceAll('{{TITLE}}', params.title)
    .replaceAll('{{VERSION_LABEL}}', params.versionLabel)
    .replaceAll('{{VERSION}}', params.versionLabel)
    .replaceAll('{{PAGE_TITLE}}', params.pageTitle)
    .replaceAll('{{STYLES}}', STYLES)
    .replaceAll('{{SIDEBAR}}', params.sidebarHtml)
    .replaceAll('{{CONTENT}}', params.contentHtml)
    .replaceAll('{{SCRIPTS}}', scripts)
}

export type { SitePage }
