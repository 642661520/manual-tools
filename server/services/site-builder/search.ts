/** 静态站点搜索索引生成 */

import type { FeatureData } from '../../types.js'
import type { SitePage } from './shared.js'

export interface SearchIndexEntry {
  text: string      // 纯文本（HTML 标签已剥离）
  chapter: string   // 章节标题
  section: string   // 节标题（章节级 entry 为空字符串）
  chNum: number
  secNum: number    // 0 = 章节级
  url: string       // ch01.html 或 ch01.html#ch1-s2
}

interface SearchIndexData {
  entries: SearchIndexEntry[]
}

/** 剥离 HTML 标签，返回纯文本 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 从 features 和 chapterPages 构建搜索索引 */
export function buildSearchIndex(
  features: FeatureData[],
  chapterPages: Map<number, SitePage[]>,
): SearchIndexData {
  const entries: SearchIndexEntry[] = []

  let chNum = 1
  for (const f of features) {
    const pages = chapterPages.get(chNum) || []
    const filename = `ch${pad(chNum)}.html`
    const isLeaf = f.sections.length === 1 && f.sections[0].key === '_default'

    if (isLeaf) {
      // 叶子章节：只有一个默认 section，只生成一条章节级 entry
      const page = pages[0]
      const text = page
        ? `${f.title} ${f.description || ''} ${stripHtml(page.content)}`
        : `${f.title} ${f.description || ''}`
      entries.push({
        text: text.trim(),
        chapter: f.title,
        section: '',
        chNum,
        secNum: 0,
        url: filename,
      })
    } else {
      // 多 section 章节：每个 section 一条 entry + 章节级 entry
      // 章节级 entry（标题 + 描述）
      const chapterText = `${f.title} ${f.description || ''}`.trim()
      if (chapterText) {
        entries.push({
          text: chapterText,
          chapter: f.title,
          section: '',
          chNum,
          secNum: 0,
          url: filename,
        })
      }

      for (let i = 0; i < f.sections.length; i++) {
        const sec = f.sections[i]
        const page = pages[i]
        const anchorId = `ch${chNum}-s${i + 1}`
        const text = page
          ? `${f.title} ${sec.title} ${sec.description || ''} ${stripHtml(page.content)}`
          : `${f.title} ${sec.title} ${sec.description || ''}`
        entries.push({
          text: text.trim(),
          chapter: f.title,
          section: sec.title,
          chNum,
          secNum: i + 1,
          url: `${filename}#${anchorId}`,
        })
      }
    }

    chNum++
  }

  return { entries }
}
