import * as Y from 'yjs'
import { getDb } from '../db/index.js'
import { isCatalogPart } from '../types.js'
import type {
  CatalogRow, CatalogFeatureEntry, CatalogEntry, FeatureRow, FeatureData,
  HeadingEntry, ManualResult,
} from '../types.js'

// ================ 手册组装 =================================================

function resolveSections(
  sectionsJson: string,
  featureTitle: string,
  sectionOrder?: string[],
): { key: string; title: string; description?: string }[] {
  const raw = JSON.parse(sectionsJson || '[]') as { key: string; title: string; description?: string }[]
  const source = raw.length > 0 ? raw : [{ key: '_default', title: featureTitle }]
  if (sectionOrder) {
    return sectionOrder.map(k => source.find(s => s.key === k)).filter(Boolean) as typeof source
  }
  return source
}

export function assembleManual(
  catalogId: string,
  opts?: {
    approvedOnly?: boolean
    featureOverride?: string
    statusOverride?: Record<string, string>
  },
): ManualResult | null {
  const approvedOnly = opts?.approvedOnly ?? false
  const statusOverride = opts?.statusOverride
  const db = getDb()
  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(catalogId) as CatalogRow | undefined
  if (!catalog) return null

  const entries: CatalogEntry[] = JSON.parse(opts?.featureOverride || catalog.features)
  const targets: string[] = JSON.parse(catalog.targets)
  const coverInfo = JSON.parse(catalog.cover_info || '{}')
  const hasParts = entries.some(isCatalogPart)

  // 展平 entries，收集所有 featureId
  const flatFeatureEntries: CatalogFeatureEntry[] = []
  for (const entry of entries) {
    if (isCatalogPart(entry)) {
      flatFeatureEntries.push(...entry.features)
    } else {
      flatFeatureEntries.push(entry)
    }
  }

  // 批量查询所有 feature（避免 N+1）
  const featureIds = flatFeatureEntries.map(e => e.featureId)
  const featureRows = featureIds.length > 0
    ? db.prepare(
      `SELECT * FROM features WHERE id IN (${featureIds.map(() => '?').join(',')})`,
    ).all(...featureIds) as FeatureRow[]
    : []
  const featureMap = new Map(featureRows.map(f => [f.id, f]))

  // 收集所有待查的 document ID
  const allDocIds: string[] = []
  for (const fe of flatFeatureEntries) {
    const f = featureMap.get(fe.featureId)
    if (!f) continue
    const sections = resolveSections(f.sections, f.title, fe.sectionOrder)
    for (const s of sections) {
      allDocIds.push(`${f.id}/${s.key}`)
    }
  }

  // 批量查询 document 状态（approvedOnly 过滤用）
  let approvedDocIds: Set<string> | null = null
  if (approvedOnly && allDocIds.length > 0) {
    const statusRows = db.prepare(
      `SELECT id, status FROM documents WHERE id IN (${allDocIds.map(() => '?').join(',')})`,
    ).all(...allDocIds) as { id: string; status: string }[]
    approvedDocIds = new Set(statusRows.filter(r => r.status === 'approved').map(r => r.id))
  }

  // 批量获取所有 document 内容（避免逐条 N+1）
  const contentMap = batchGetDocumentContents(allDocIds)

  const features: FeatureData[] = []
  for (const entry of entries) {
    const processFeature = (fe: CatalogFeatureEntry) => {
      const f = featureMap.get(fe.featureId)
      if (!f) return
      const ordered = resolveSections(f.sections, f.title, fe.sectionOrder)

      const sections = approvedOnly
        ? ordered.filter(s => {
            const docId = `${f.id}/${s.key}`
            if (statusOverride && docId in statusOverride) {
              return statusOverride[docId] === 'approved'
            }
            return approvedDocIds?.has(docId) ?? false
          })
        : ordered

      features.push({
        id: f.id,
        title: f.title,
        description: f.description,
        sections,
      })
    }

    if (isCatalogPart(entry)) {
      for (const fe of entry.features) {
        processFeature(fe)
      }
    } else {
      processFeature(entry)
    }
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

  // 构建 featureId → FeatureData 映射（用于 TOC/正文按 entry 顺序查找）
  const featuresMap = new Map(features.map(f => [f.id, f]))

  // 收集标题树
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
  let partIdx = 0
  const tocLines: string[] = []
  for (const entry of entries) {
    if (isCatalogPart(entry)) {
      partIdx++
      tocLines.push(`- **${entry.title}**`)
      for (const fe of entry.features) {
        const f = featuresMap.get(fe.featureId)
        if (!f) continue
        const hid = headingId(`ch${chapterNum}`)
        tocLines.push(`    ${chapterNum}. [${f.title}](#${hid})`)
        for (let i = 0; i < f.sections.length; i++) {
          const sid = headingId(`ch${chapterNum}-s${i + 1}`)
          tocLines.push(`        ${chapterNum}.${i + 1} [${f.sections[i].title}](#${sid})`)
        }
        chapterNum++
      }
    } else {
      const f = featuresMap.get(entry.featureId)
      if (!f) continue
      const hid = headingId(`ch${chapterNum}`)
      tocLines.push(`${chapterNum}. [${f.title}](#${hid})`)
      for (let i = 0; i < f.sections.length; i++) {
        const sid = headingId(`ch${chapterNum}-s${i + 1}`)
        tocLines.push(`   ${chapterNum}.${i + 1} [${f.sections[i].title}](#${sid})`)
      }
      chapterNum++
    }
  }
  md += tocLines.join('\n')
  md += `\n\n---\n\n`

  // 正文
  chapterNum = 1
  partIdx = 0
  for (const entry of entries) {
    if (isCatalogPart(entry)) {
      partIdx++
      const partId = `part-${partIdx}`
      md += `## <a id="${partId}"></a>${entry.title}\n\n`
      headings.push({ level: 2, text: entry.title, id: partId })

      for (const fe of entry.features) {
        const f = featuresMap.get(fe.featureId)
        if (!f) continue
        const chId = headingId(`ch${chapterNum}`)
        md += `### <a id="${chId}"></a>${chapterNum}. ${f.title}\n\n`
        headings.push({ level: 3, text: `${chapterNum}. ${f.title}`, id: chId })
        md += `${f.description}\n\n`

        for (let i = 0; i < f.sections.length; i++) {
          const sec = f.sections[i]
          const secId = headingId(`ch${chapterNum}-s${i + 1}`)
          if (sec.key !== '_default') {
            md += `#### <a id="${secId}"></a>${chapterNum}.${i + 1} ${sec.title}\n\n`
            headings.push({ level: 4, text: `${chapterNum}.${i + 1} ${sec.title}`, id: secId })
          }
          if (sec.description) md += `> ${sec.description}\n\n`

          const docId = `${f.id}/${sec.key}`
          const content = contentMap.get(docId) ?? ''
          const resolved = resolveCrossReferences(content, chapterMap)
          md += resolved ? `${resolved}\n\n` : `> *（本章节暂未编写）*\n\n`
        }
        chapterNum++
      }
    } else {
      const f = featuresMap.get(entry.featureId)
      if (!f) continue
      const chId = headingId(`ch${chapterNum}`)
      if (hasParts) {
        md += `### <a id="${chId}"></a>${chapterNum}. ${f.title}\n\n`
        headings.push({ level: 3, text: `${chapterNum}. ${f.title}`, id: chId })
      } else {
        md += `## <a id="${chId}"></a>${chapterNum}. ${f.title}\n\n`
        headings.push({ level: 2, text: `${chapterNum}. ${f.title}`, id: chId })
      }
      md += `${f.description}\n\n`

      for (let i = 0; i < f.sections.length; i++) {
        const sec = f.sections[i]
        const secId = headingId(`ch${chapterNum}-s${i + 1}`)
        if (sec.key !== '_default') {
          if (hasParts) {
            md += `#### <a id="${secId}"></a>${chapterNum}.${i + 1} ${sec.title}\n\n`
            headings.push({ level: 4, text: `${chapterNum}.${i + 1} ${sec.title}`, id: secId })
          } else {
            md += `### <a id="${secId}"></a>${chapterNum}.${i + 1} ${sec.title}\n\n`
            headings.push({ level: 3, text: `${chapterNum}.${i + 1} ${sec.title}`, id: secId })
          }
        }
        if (sec.description) md += `> ${sec.description}\n\n`

        const docId = `${f.id}/${sec.key}`
        const content = contentMap.get(docId) ?? ''
        const resolved = resolveCrossReferences(content, chapterMap)
        md += resolved ? `${resolved}\n\n` : `> *（本章节暂未编写）*\n\n`
      }
      chapterNum++
    }
  }

  const catalogRow = catalog as Omit<CatalogRow, 'targets' | 'cover_info' | 'features'>
  return {
    catalog: { ...catalogRow, targets, coverInfo, entries },
    features,
    markdown: md,
    headings,
  }
}

export function headingId(base: string): string {
  return base.toLowerCase().replace(/\s+/g, '-')
}

// ================ 单章组装 ===================================================

export interface ChapterResult {
  chNum: number
  featureId: string
  featureTitle: string
  markdown: string
  headings: HeadingEntry[]
  totalChapters: number
  hasParts: boolean
  partTitle?: string
  partIdx?: number
}

/** 组装单章 markdown（用于预览按需加载） */
export function assembleChapter(
  catalogId: string,
  chNum: number,
  opts?: {
    approvedOnly?: boolean
    featureOverride?: string
    statusOverride?: Record<string, string>
  },
): ChapterResult | null {
  const approvedOnly = opts?.approvedOnly ?? false
  const statusOverride = opts?.statusOverride
  const db = getDb()
  const catalog = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(catalogId) as CatalogRow | undefined
  if (!catalog) return null

  const entries: CatalogEntry[] = JSON.parse(opts?.featureOverride || catalog.features)
  const hasParts = entries.some(isCatalogPart)

  // 展平 entries 并维护 chNum → feature 映射
  const flat: { featureId: string; sectionOrder?: string[]; partTitle?: string; partIdx?: number }[] = []
  let partIdx = 0
  for (const entry of entries) {
    if (isCatalogPart(entry)) {
      partIdx++
      for (const fe of entry.features) {
        flat.push({ featureId: fe.featureId, sectionOrder: fe.sectionOrder, partTitle: entry.title, partIdx })
      }
    } else {
      flat.push({ featureId: entry.featureId, sectionOrder: entry.sectionOrder })
    }
  }
  const totalChapters = flat.length
  if (chNum < 1 || chNum > totalChapters) return null
  const target = flat[chNum - 1]

  // 批量查询所有 feature（构建 chapterMap 用于交叉引用）
  const allFeatureIds = flat.map(e => e.featureId)
  const featureRows = db.prepare(
    `SELECT * FROM features WHERE id IN (${allFeatureIds.map(() => '?').join(',')})`,
  ).all(...allFeatureIds) as FeatureRow[]
  const featureMap = new Map(featureRows.map(f => [f.id, f]))

  // 构建 chapterMap
  const chapterMap = buildChapterMap(flat, featureMap)

  // 获取目标 feature
  const f = featureMap.get(target.featureId)
  if (!f) return null

  const ordered = resolveSections(f.sections, f.title, target.sectionOrder)

  // 收集本章的 document IDs
  const chapterDocIds = ordered.map(s => `${f.id}/${s.key}`)

  // approvedOnly 过滤
  let approvedDocIds: Set<string> | null = null
  if (approvedOnly && chapterDocIds.length > 0) {
    const statusRows = db.prepare(
      `SELECT id, status FROM documents WHERE id IN (${chapterDocIds.map(() => '?').join(',')})`,
    ).all(...chapterDocIds) as { id: string; status: string }[]
    approvedDocIds = new Set(statusRows.filter(r => r.status === 'approved').map(r => r.id))
  }

  // 过滤 sections
  const sections = approvedOnly
    ? ordered.filter(s => {
        const docId = `${f.id}/${s.key}`
        if (statusOverride && docId in statusOverride) return statusOverride[docId] === 'approved'
        return approvedDocIds?.has(docId) ?? false
      })
    : ordered

  // 获取本章 document 内容
  const sectionDocIds = sections.map(s => `${f.id}/${s.key}`)
  const contentMap = sectionDocIds.length > 0
    ? batchGetDocumentContents(sectionDocIds)
    : new Map<string, string>()

  // 组装 markdown
  let md = ''
  const headings: HeadingEntry[] = []

  // Part 标题（如果属于某个 Part）
  if (target.partTitle) {
    const partId = `part-${target.partIdx}`
    md += `## <a id="${partId}"></a>${target.partTitle}\n\n`
    headings.push({ level: 2, text: target.partTitle, id: partId })
  }

  // Feature 标题
  const chId = headingId(`ch${chNum}`)
  const featLevel = hasParts ? 3 : 2
  if (featLevel === 3) {
    md += `### <a id="${chId}"></a>${chNum}. ${f.title}\n\n`
    headings.push({ level: 3, text: `${chNum}. ${f.title}`, id: chId })
  } else {
    md += `## <a id="${chId}"></a>${chNum}. ${f.title}\n\n`
    headings.push({ level: 2, text: `${chNum}. ${f.title}`, id: chId })
  }
  md += `${f.description}\n\n`

  // Sections
  const secLevel = hasParts ? 4 : 3
  const secTag = '#'.repeat(secLevel)
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]
    const secId = headingId(`ch${chNum}-s${i + 1}`)
    if (sec.key !== '_default') {
      md += `${secTag} <a id="${secId}"></a>${chNum}.${i + 1} ${sec.title}\n\n`
      headings.push({ level: secLevel, text: `${chNum}.${i + 1} ${sec.title}`, id: secId })
    }
    if (sec.description) md += `> ${sec.description}\n\n`

    const docId = `${f.id}/${sec.key}`
    const content = contentMap.get(docId) ?? ''
    const resolved = resolveCrossReferences(content, chapterMap)
    md += resolved ? `${resolved}\n\n` : `> *（本章节暂未编写）*\n\n`
  }

  return {
    chNum,
    featureId: f.id,
    featureTitle: f.title,
    markdown: md,
    headings,
    totalChapters,
    hasParts,
    partTitle: target.partTitle,
    partIdx: target.partIdx,
  }
}

/** 构建 featureId → 章节信息映射 */
function buildChapterMap(
  flat: { featureId: string }[],
  featureMap: Map<string, FeatureRow>,
): Map<string, { num: number; anchorId: string; title: string; sections: Record<string, { anchorId: string; title: string }> }> {
  const map = new Map<string, { num: number; anchorId: string; title: string; sections: Record<string, { anchorId: string; title: string }> }>()
  let chNum = 1
  for (const fe of flat) {
    const f = featureMap.get(fe.featureId)
    if (!f) continue
    const sections = resolveSections(f.sections, f.title) as { key: string; title: string }[]
    const sectionAnchors: Record<string, { anchorId: string; title: string }> = {}
    for (let i = 0; i < sections.length; i++) {
      sectionAnchors[sections[i].key] = {
        anchorId: headingId(`ch${chNum}-s${i + 1}`),
        title: sections[i].title,
      }
    }
    map.set(f.id, {
      num: chNum,
      anchorId: headingId(`ch${chNum}`),
      title: f.title,
      sections: sectionAnchors,
    })
    chNum++
  }
  return map
}

// ================ 批量文档内容读取 =========================================

/** 批量获取 document 内容：2 次查询替代 2*N 次查询 */
function batchGetDocumentContents(docIds: string[]): Map<string, string> {
  const result = new Map<string, string>()
  if (docIds.length === 0) return result
  const db = getDb()

  const placeholders = docIds.map(() => '?').join(',')

  const allUpdates = db.prepare(
    `SELECT document_id, update_data FROM document_updates WHERE document_id IN (${placeholders}) ORDER BY id ASC`,
  ).all(...docIds) as Array<{ document_id: string; update_data: Buffer }>

  const allSnapshots = db.prepare(
    `SELECT document_id, snapshot_data FROM document_snapshots WHERE document_id IN (${placeholders}) ORDER BY id DESC`,
  ).all(...docIds) as Array<{ document_id: string; snapshot_data: Buffer }>

  const updatesByDoc = new Map<string, Buffer[]>()
  for (const row of allUpdates) {
    if (!updatesByDoc.has(row.document_id)) updatesByDoc.set(row.document_id, [])
    updatesByDoc.get(row.document_id)!.push(row.update_data)
  }

  const snapshotByDoc = new Map<string, Buffer>()
  for (const row of allSnapshots) {
    if (!snapshotByDoc.has(row.document_id)) {
      snapshotByDoc.set(row.document_id, row.snapshot_data)
    }
  }

  for (const docId of docIds) {
    const updates = updatesByDoc.get(docId)
    const doc = new Y.Doc()
    if (updates && updates.length > 0) {
      for (const update of updates) {
        Y.applyUpdate(doc, new Uint8Array(update))
      }
    } else {
      const snapshot = snapshotByDoc.get(docId)
      if (!snapshot) continue
      Y.applyUpdate(doc, new Uint8Array(snapshot))
    }
    result.set(docId, doc.getText('content').toString())
  }

  return result
}

// ================ 交叉引用解析 =============================================

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
  return html.replace(
    /<crossref\s+[^>]*(?:data-feature-id|featureid|featureId)="([^"]+)"[^>]*>(?:[^<]*)<\/crossref>/gi,
    (_match, featureId: string) => {
      const sectionMatch = _match.match(/(?:data-section-key|sectionkey|sectionKey)="([^"]*)"/i)
      const sectionKey = sectionMatch ? sectionMatch[1] : ''
      const info = chapterMap.get(featureId)
      if (!info) return '→ 参见：*（未收录）*'
      if (sectionKey && info.sections[sectionKey]) {
        const sec = info.sections[sectionKey]
        return `→ 参见：[第 ${info.num} 章 ${info.title} › ${sec.title}](#${sec.anchorId})`
      }
      return `→ 参见：[第 ${info.num} 章 ${info.title}](#${info.anchorId})`
    },
  )
}
