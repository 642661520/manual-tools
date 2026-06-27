import type { FeatureData } from '../../types.js'
import type { PartMeta } from './shared.js'
import { escHtml, pad, buildFeaturePartMap } from './shared.js'

function isLeafChapter(f: FeatureData): boolean {
  return f.sections.length === 1 && f.sections[0].key === '_default'
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

      html += `<li class="vp-nav-chapter${isActive ? ' active' : ''}">`
      if (isLeaf) {
        html += `<a href="${filename}" class="vp-nav-chapter-btn">${chNum}. ${escHtml(f.title)}</a>`
      } else {
        html += `<button class="vp-nav-chapter-btn" onclick="toggleChapter(this)" aria-expanded="${isActive}">${chNum}. ${escHtml(f.title)}</button>`
        html += `<ul class="vp-nav-sections"${isActive ? '' : ' style="display:none"'}>`
        for (let i = 0; i < f.sections.length; i++) {
          const sec = f.sections[i]
          const anchorId = `ch${chNum}-s${i + 1}`
          const href = isActive ? `#${anchorId}` : `${filename}#${anchorId}`
          html += `<li><a href="${href}" class="vp-nav-section-link" data-id="${anchorId}">${chNum}.${i + 1} ${escHtml(sec.title)}</a></li>`
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
        // 检查当前 Part 是否包含当前激活的章节
        const isActivePart = partInfo.featureIds.some(fid => {
          const idx = features.findIndex(ff => ff.id === fid)
          return idx >= 0 && (idx + 1) === currentChapter
        })
        html += `<li class="vp-nav-part${isActivePart ? '' : ' collapsed'}">`
        html += `<button class="vp-nav-part-btn" onclick="togglePart(this)" aria-expanded="${isActivePart}">${escHtml(partInfo.title)}</button>`
        html += `<ul class="vp-nav-chapters"${isActivePart ? '' : ' style="display:none"'}>`
      }
      lastPartIdx = currentPartIdx
    }

    const filename = `ch${pad(chNum)}.html`
    const isActive = currentChapter === chNum
    const isLeaf = isLeafChapter(f)

    html += `<li class="vp-nav-chapter${isActive ? ' active' : ''}">`
    if (isLeaf) {
      html += `<a href="${filename}" class="vp-nav-chapter-btn">${chNum}. ${escHtml(f.title)}</a>`
    } else {
      html += `<button class="vp-nav-chapter-btn" onclick="toggleChapter(this)" aria-expanded="${isActive}">${chNum}. ${escHtml(f.title)}</button>`
      html += `<ul class="vp-nav-sections"${isActive ? '' : ' style="display:none"'}>`
      for (let i = 0; i < f.sections.length; i++) {
        const sec = f.sections[i]
        const anchorId = `ch${chNum}-s${i + 1}`
        const href = isActive ? `#${anchorId}` : `${filename}#${anchorId}`
        html += `<li><a href="${href}" class="vp-nav-section-link" data-id="${anchorId}">${chNum}.${i + 1} ${escHtml(sec.title)}</a></li>`
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
