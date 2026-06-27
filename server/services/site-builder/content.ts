import type { FeatureData } from '../../types.js'
import type { SitePage, PartMeta } from './shared.js'
import { escHtml, rewriteCrossLinks } from './shared.js'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 构建 featureId → part 映射 */
function buildFeaturePartMap(parts: PartMeta[]): Map<string, { title: string; idx: number } | null> {
  const map = new Map<string, { title: string; idx: number } | null>()
  for (const part of parts) {
    for (const fid of part.featureIds) {
      map.set(fid, { title: part.title, idx: part.idx })
    }
  }
  return map
}

/** 构建封面页 HTML（标题 + TOC） */
export function buildCoverContentHtml(
  features: FeatureData[],
  parts: PartMeta[],
  hasParts: boolean,
  catalogTitle: string,
): string {
  let html = `<section class="cover-page">
    <h1>${escHtml(catalogTitle)}</h1>

    <h2>目录</h2>
    <ul class="toc-list">`

  if (!hasParts) {
    let chNum = 1
    for (const f of features) {
      const filename = `ch${pad(chNum)}.html`
      const isLeaf = f.sections.length === 1 && f.sections[0].key === '_default'
      html += `<li class="toc-chapter">
        <a href="${filename}">${chNum}. ${escHtml(f.title)}</a>`
      if (!isLeaf) {
        html += `<ul class="toc-sections">`
        for (let i = 0; i < f.sections.length; i++) {
          html += `<li><a href="${filename}#ch${chNum}-s${i + 1}">${chNum}.${i + 1} ${escHtml(f.sections[i].title)}</a></li>`
        }
        html += `</ul>`
      }
      html += `</li>`
      chNum++
    }
  } else {
    const featurePartMap = buildFeaturePartMap(parts)
    let chNum = 1
    let lastPartIdx = -1

    for (const f of features) {
      const partInfo = featurePartMap.get(f.id)
      const currentPartIdx = partInfo?.idx ?? -1

      if (currentPartIdx !== lastPartIdx) {
        if (lastPartIdx >= 0) html += `</ul></li>`
        if (partInfo) {
          html += `<li class="toc-part">
            <span class="toc-part-title">${escHtml(partInfo.title)}</span>
            <ul class="toc-chapters">`
        }
        lastPartIdx = currentPartIdx
      }

      const filename = `ch${pad(chNum)}.html`
      html += `<li><a href="${filename}">${chNum}. ${escHtml(f.title)}</a></li>`
      chNum++
    }
    if (lastPartIdx >= 0) html += `</ul></li>`
  }

  html += `</ul></section>`
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

  // 如果属于某个 Part，先渲染 Part 标题
  if (hasParts) {
    for (const part of parts) {
      if (part.featureIds.includes(feature.id)) {
        html += `<section class="part" id="part-${part.idx}">
          <h2>${escHtml(part.title)}</h2>`
        break
      }
    }
  }

  // 章节标题
  const headingTag = hasParts ? 'h3' : 'h2'
  html += `<section class="chapter" id="ch${chNum}">
    <${headingTag}>${chNum}. ${escHtml(feature.title)}</${headingTag}>`

  if (feature.description) {
    html += `<p class="chapter-desc">${escHtml(feature.description)}</p>`
  }

  // 各节内容
  const sectionTag = hasParts ? 'h4' : 'h3'
  const isLeaf = feature.sections.length === 1 && feature.sections[0].key === '_default'
  for (let i = 0; i < feature.sections.length; i++) {
    const sec = feature.sections[i]
    const anchorId = `ch${chNum}-s${i + 1}`
    const page = pages[i]

    html += `<section class="section" id="${anchorId}">`
    // 默认章节不显示节标题（与章节名重复）
    if (!isLeaf) {
      html += `<${sectionTag}>${chNum}.${i + 1} ${escHtml(sec.title)}</${sectionTag}>`
    }

    if (sec.description) {
      html += `<blockquote>${escHtml(sec.description)}</blockquote>`
    }

    if (page) {
      const content = rewriteCrossLinks(page.content, chNum)
      html += `<div class="section-body">${content}</div>`
    } else {
      html += `<p class="muted">（暂未编写）</p>`
    }

    html += `</section>`
  }

  html += `</section>` // close chapter
  if (hasParts) {
    // close part section if it was opened
    for (const part of parts) {
      if (part.featureIds.includes(feature.id)) {
        html += `</section>` // close part
        break
      }
    }
  }

  // 上一章 / 下一章导航
  html += `<nav class="chapter-nav">
    ${chNum > 1
      ? `<a href="ch${pad(chNum - 1)}.html" class="chapter-nav-prev">← 上一章</a>`
      : `<span class="chapter-nav-prev disabled">← 上一章</span>`}
    <span class="chapter-nav-pos">${chNum} / ${totalChapters}</span>
    ${chNum < totalChapters
      ? `<a href="ch${pad(chNum + 1)}.html" class="chapter-nav-next">下一章 →</a>`
      : `<span class="chapter-nav-next disabled">下一章 →</span>`}
  </nav>`

  return html
}
