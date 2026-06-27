import type { FeatureData } from '../../types.js'
import type { SitePage, PartMeta, TocItem } from './shared.js'
import {
  escHtml,
  rewriteCrossLinks,
  pad,
  buildFeaturePartMap,
  stripHtml,
  slugify,
} from './shared.js'

/** 构建封面页 HTML（标题 + TOC） */
export function buildCoverContentHtml(
  features: FeatureData[],
  parts: PartMeta[],
  hasParts: boolean,
  catalogTitle: string,
): string {
  let html = `<section class="vp-cover">
    <h1>${escHtml(catalogTitle)}</h1>`

  html += `
    <div class="vp-cover-toc-header">目录</div>`

  if (!hasParts) {
    html += `<ul class="vp-toc-chapter-list">`
    let chNum = 1
    for (const f of features) {
      const filename = `ch${pad(chNum)}.html`
      const isLeaf = f.sections.length === 1 && f.sections[0].key === '_default'
      html += `<li class="vp-toc-chapter-item">
        <a href="${filename}" class="vp-toc-chapter-link">${chNum}. ${escHtml(f.title)}</a>`
      if (!isLeaf) {
        html += `<ul class="vp-toc-section-list">`
        for (let i = 0; i < f.sections.length; i++) {
          html += `<li><a href="${filename}#ch${chNum}-s${i + 1}" class="vp-toc-section-link">${chNum}.${i + 1} ${escHtml(f.sections[i].title)}</a></li>`
        }
        html += `</ul>`
      }
      html += `</li>`
      chNum++
    }
    html += `</ul>`
  } else {
    const featurePartMap = buildFeaturePartMap(parts)
    let chNum = 1
    let lastPartIdx = -1

    html += `<ul class="vp-toc-chapter-list">`

    for (const f of features) {
      const partInfo = featurePartMap.get(f.id)
      const currentPartIdx = partInfo?.idx ?? -1

      if (currentPartIdx !== lastPartIdx) {
        if (lastPartIdx >= 0) {
          html += `</ul></li>` // close previous part
        }
        if (partInfo) {
          html += `<li class="vp-toc-part">
            <div class="vp-toc-part-title">${escHtml(partInfo.title)}</div>
            <ul class="vp-toc-chapter-list">`
        }
        lastPartIdx = currentPartIdx
      }

      const filename = `ch${pad(chNum)}.html`
      html += `<li><a href="${filename}" class="vp-toc-chapter-link">${chNum}. ${escHtml(f.title)}</a></li>`
      chNum++
    }
    if (lastPartIdx >= 0) html += `</ul></li>`
    html += `</ul>`
  }

  html += `</section>`
  return html
}

/** 构建单章内容 HTML */
export function buildChapterContentHtml(
  feature: FeatureData,
  chNum: number,
  pages: SitePage[],
  parts: PartMeta[],
  hasParts: boolean,
  totalChapters: number,
): string {
  let html = ''

  // 如果属于某个 Part，显示 Part 标签
  if (hasParts) {
    for (const part of parts) {
      if (part.featureIds.includes(feature.id)) {
        html += `<div class="vp-part-heading">${escHtml(part.title)}</div>`
        break
      }
    }
  }

  // 章节
  html += `<section class="vp-chapter" id="ch${chNum}">
    <h1 class="vp-chapter-title">${chNum}. ${escHtml(feature.title)}</h1>`

  if (feature.description) {
    html += `<p class="vp-chapter-desc">${escHtml(feature.description)}</p>`
  }

  // 各节内容
  const isLeaf = feature.sections.length === 1 && feature.sections[0].key === '_default'
  for (let i = 0; i < feature.sections.length; i++) {
    const sec = feature.sections[i]
    const anchorId = `ch${chNum}-s${i + 1}`
    const page = pages[i]

    html += `<section class="vp-section" id="${anchorId}">`
    // 默认章节不显示节标题（与章节名重复）
    if (!isLeaf) {
      html += `<h2 class="vp-section-title">${chNum}.${i + 1} ${escHtml(sec.title)}</h2>`
    }

    if (sec.description) {
      html += `<blockquote class="vp-section-desc">${escHtml(sec.description)}</blockquote>`
    }

    if (page) {
      const content = rewriteCrossLinks(page.content, chNum)
      html += `<div class="vp-section-body">${content}</div>`
    } else {
      html += `<p class="muted">（暂未编写）</p>`
    }

    html += `</section>`
  }

  html += `</section>` // close chapter

  // 上一章 / 下一章导航
  html += `<nav class="vp-chapter-nav">
    ${
      chNum > 1
        ? `<a href="ch${pad(chNum - 1)}.html" class="vp-chapter-nav-link">
           <svg class="vp-chapter-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
           上一章</a>`
        : `<span class="vp-chapter-nav-link disabled">
           <svg class="vp-chapter-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
           上一章</span>`
    }
    <span class="vp-chapter-nav-pos">${chNum} / ${totalChapters}</span>
    ${
      chNum < totalChapters
        ? `<a href="ch${pad(chNum + 1)}.html" class="vp-chapter-nav-link">
           下一章
           <svg class="vp-chapter-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></a>`
        : `<span class="vp-chapter-nav-link disabled">
           下一章
           <svg class="vp-chapter-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></span>`
    }
  </nav>`

  return html
}

/** 为 body HTML 中的 h1-h4 注入 id 属性，返回注入后的 HTML + 提取的标题 */
export function processContentHeadings(html: string): {
  html: string
  headings: { level: number; id: string; text: string }[]
} {
  const headings: { level: number; id: string; text: string }[] = []
  const seenIds = new Set<string>()

  const processed = html.replace(
    /<h([1-4])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi,
    (_full, tagNum, attrs, innerHtml) => {
      const attrStr = (attrs || '').trim()
      const text = stripHtml(innerHtml).trim()
      if (!text) return _full

      let id: string
      const idMatch = attrStr.match(/\bid\s*=\s*["']([^"']+)["']/)
      if (idMatch) {
        id = idMatch[1]
      } else {
        id = slugify(text)
        // 去重
        let dedupe = id
        let n = 1
        while (seenIds.has(dedupe)) {
          dedupe = `${id}-${n++}`
        }
        id = dedupe
      }
      seenIds.add(id)

      // TOC level: h1→L2, h2→L3, h3→L4, h4→L5
      const level = parseInt(tagNum) + 1
      headings.push({ level, id, text })

      // 重建标签（保留原有属性 + 注入 id）
      if (idMatch) return _full
      const newAttrs = attrStr ? ` ${attrStr} id="${id}"` : ` id="${id}"`
      return `<h${tagNum}${newAttrs}>${innerHtml}</h${tagNum}>`
    },
  )

  return { html: processed, headings }
}

/** 从 body HTML 中提取 h1-h4 子标题（用于右侧 TOC） */
function extractSubHeadings(html: string): { level: number; id: string; text: string }[] {
  const results: { level: number; id: string; text: string }[] = []
  const regex = /<h([1-4])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const tagLevel = parseInt(match[1])
    const attrStr = (match[2] || '').trim()
    const innerHtml = match[3]
    const text = stripHtml(innerHtml).trim()
    if (!text) continue

    // 检查是否已有 id
    const idMatch = attrStr.match(/\bid\s*=\s*["']([^"']+)["']/)
    const id = idMatch ? idMatch[1] : slugify(text)

    // TOC level: h1→L2, h2→L3, h3→L4, h4→L5
    results.push({ level: tagLevel + 1, id, text })
  }
  return results
}

/** 构建右侧本页目录 HTML */
export function buildTocHtml(feature: FeatureData, chNum: number, pages: SitePage[]): string {
  const items: TocItem[] = []
  const isLeaf = feature.sections.length === 1 && feature.sections[0].key === '_default'

  // Level 1: 章节标题（叶子章节不加编号前缀）
  items.push({
    level: 1,
    id: `ch${chNum}`,
    title: isLeaf ? feature.title : `${chNum}. ${feature.title}`,
  })

  if (!isLeaf) {
    for (let i = 0; i < feature.sections.length; i++) {
      const sec = feature.sections[i]
      const anchorId = `ch${chNum}-s${i + 1}`
      // Level 2: 节标题
      items.push({
        level: 2,
        id: anchorId,
        title: `${chNum}.${i + 1} ${sec.title}`,
      })

      // Level 3+: 从节 body 中提取子标题
      const page = pages[i]
      if (page) {
        const subHeadings = extractSubHeadings(page.content)
        for (const h of subHeadings) {
          items.push({
            level: Math.min(h.level, 4),
            id: h.id,
            title: h.text,
          })
        }
      }
    }
  } else {
    // 叶子章节：从唯一 section 的 body 中提取子标题
    const page = pages[0]
    if (page) {
      const subHeadings = extractSubHeadings(page.content)
      for (const h of subHeadings) {
        items.push({
          level: Math.min(h.level, 4),
          id: h.id,
          title: h.text,
        })
      }
    }
  }

  // 只有章节标题且无子标题，不显示 TOC
  if (items.length <= 1) return ''

  let html = '<aside class="vp-toc" id="vpToc">\n'
  html += '  <div class="vp-toc-header">本页目录</div>\n'
  html += '  <nav class="vp-toc-nav">\n'
  html += '    <ul class="vp-toc-list">\n'

  for (const item of items) {
    const indentClass = item.level > 1 ? ` vp-toc-l${item.level}` : ''
    html += `      <li class="vp-toc-item${indentClass}"><a href="#${item.id}" class="vp-toc-link" data-toc-id="${item.id}">${escHtml(item.title)}</a></li>\n`
  }

  html += '    </ul>\n'
  html += '  </nav>\n'
  html += '</aside>'

  return html
}
