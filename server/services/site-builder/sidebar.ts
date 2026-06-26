import type { FeatureData } from '../../types.js'
import type { PartMeta } from './shared.js'
import { escHtml } from './shared.js'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isLeafChapter(f: FeatureData): boolean {
  return f.sections.length === 1 && f.sections[0].key === '_default'
}

/**
 * 构建 featureId → part 映射（用于查询 feature 所属的 part）
 * 始终以 `features` 数组的顺序为准进行编号
 */
function buildFeaturePartMap(parts: PartMeta[]): Map<string, { title: string; idx: number } | null> {
  const map = new Map<string, { title: string; idx: number } | null>()
  for (const part of parts) {
    for (const fid of part.featureIds) {
      map.set(fid, { title: part.title, idx: part.idx })
    }
  }
  // 不在任何 Part 中的 feature 设为 null
  return map
}

/** 构建侧边栏导航 HTML（支持 Part 分组和跨页链接） */
export function buildSidebarHtml(
  features: FeatureData[],
  parts: PartMeta[],
  hasParts: boolean,
  currentChapter?: number,
): string {
  if (!hasParts) {
    let html = ''
    let chNum = 1
    for (const f of features) {
      const filename = `ch${pad(chNum)}.html`
      const isActive = currentChapter === chNum
      const isLeaf = isLeafChapter(f)
      html += `<li class="nav-chapter${isActive ? ' active' : ''}">`
      if (isLeaf) {
        html += `<a href="${filename}" class="nav-chapter-btn">${chNum}. ${escHtml(f.title)}</a>`
      } else {
        html += `<button class="nav-chapter-btn" onclick="toggleChapter(this)">${chNum}. ${escHtml(f.title)}</button>
      <ul class="nav-sections">`
        for (let i = 0; i < f.sections.length; i++) {
          const sec = f.sections[i]
          const anchorId = `ch${chNum}-s${i + 1}`
          const href = isActive ? `#${anchorId}` : `${filename}#${anchorId}`
          html += `<li><a href="${href}" class="nav-section-link" data-id="${anchorId}">${chNum}.${i + 1} ${escHtml(sec.title)}</a></li>`
        }
        html += `</ul>`
      }
      html += `</li>`
      chNum++
    }
    return html
  }

  const featurePartMap = buildFeaturePartMap(parts)

  // 按 features 数组顺序遍历，遇到 Part 切换时输出 Part 标题
  let html = ''
  let chNum = 1
  let lastPartIdx = -1

  for (const f of features) {
    const partInfo = featurePartMap.get(f.id)
    const currentPartIdx = partInfo?.idx ?? -1

    // 进入新 Part 时输出 Part 标题
    if (currentPartIdx !== lastPartIdx) {
      if (lastPartIdx >= 0) {
        html += `</ul></li>` // 关闭上一个 Part
      }
      if (partInfo) {
        html += `<li class="nav-part">
      <button class="nav-part-btn" onclick="togglePart(this)">${escHtml(partInfo.title)}</button>
      <ul class="nav-chapters">`
      }
      lastPartIdx = currentPartIdx
    }

    const filename = `ch${pad(chNum)}.html`
    const isActive = currentChapter === chNum
    const isLeaf = isLeafChapter(f)
    html += `<li class="nav-chapter${isActive ? ' active' : ''}">`
    if (isLeaf) {
      html += `<a href="${filename}" class="nav-chapter-btn">${chNum}. ${escHtml(f.title)}</a>`
    } else {
      html += `<button class="nav-chapter-btn" onclick="toggleChapter(this)">${chNum}. ${escHtml(f.title)}</button>
      <ul class="nav-sections">`
      for (let i = 0; i < f.sections.length; i++) {
        const sec = f.sections[i]
        const anchorId = `ch${chNum}-s${i + 1}`
        const href = isActive ? `#${anchorId}` : `${filename}#${anchorId}`
        html += `<li><a href="${href}" class="nav-section-link" data-id="${anchorId}">${chNum}.${i + 1} ${escHtml(sec.title)}</a></li>`
      }
      html += `</ul>`
    }
    html += `</li>`
    chNum++
  }

  if (lastPartIdx >= 0) {
    html += `</ul></li>` // 关闭最后一个 Part
  }

  return html
}
