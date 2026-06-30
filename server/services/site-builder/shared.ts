/** site-builder 内部共享类型和工具 */

export interface SitePage {
  id: string
  title: string
  content: string // HTML
}

export interface PartMeta {
  title: string
  idx: number // 1-based part index
  featureIds: string[]
}

export interface TocItem {
  level: number // 1=chapter, 2=section, 3=h2 sub-heading, 4=h3 sub-heading
  id: string // anchor id
  title: string
}

export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

/** 生成 URL 友好的 slug（支持中文） */
export function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\w一-鿿\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'heading'
  )
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 构建 featureId → part 映射 */
export function buildFeaturePartMap(
  parts: PartMeta[],
): Map<string, { title: string; idx: number; featureIds: string[] }> {
  const map = new Map<string, { title: string; idx: number; featureIds: string[] }>()
  for (const part of parts) {
    for (const fid of part.featureIds) {
      map.set(fid, { title: part.title, idx: part.idx, featureIds: part.featureIds })
    }
  }
  return map
}

/** 解析 <crossref> 自定义元素，替换为 HTML 链接（用于静态站点） */
export function resolveCrossReferencesHtml(
  html: string,
  chapterMap: Map<
    string,
    {
      num: number
      anchorId: string
      title: string
      sections: Record<string, { anchorId: string; title: string }>
    }
  >,
): string {
  if (!html) return html
  return html.replace(
    /<crossref\b[^>]*?\bdata-feature-id="([^"]*)"([^>]*?)(?:\/>|>([\s\S]*?)<\/crossref>)/gi,
    (_match, featureId: string, restAttrs: string, innerContent?: string) => {
      if (!featureId) return _match
      let sectionKey = ''
      const secMatch = restAttrs.match(/\bdata-section-key="([^"]*)"/i)
      if (secMatch) {
        sectionKey = secMatch[1]
      } else if (innerContent !== undefined) {
        const contentMatch = innerContent.match(/\bdata-section-key="([^"]*)"/i)
        if (contentMatch) sectionKey = contentMatch[1]
      }
      const info = chapterMap.get(featureId)
      if (!info) return '→ 参见：<em>（未收录）</em>'
      if (sectionKey && info.sections[sectionKey]) {
        const sec = info.sections[sectionKey]
        return `→ 参见：<a href="#${escAttr(sec.anchorId)}" class="crossref-link">第 ${info.num} 章 ${escHtml(info.title)} › ${escHtml(sec.title)}</a>`
      }
      return `→ 参见：<a href="#${escAttr(info.anchorId)}" class="crossref-link">第 ${info.num} 章 ${escHtml(info.title)}</a>`
    },
  )
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}

/** 改写 HTML 中的交叉引用链接：同章保留 hash，异章改为跨页链接 */
export function rewriteCrossLinks(html: string, currentCh: number): string {
  return html.replace(/href="#ch(\d+)(-s\d+)?"/g, (_match, chStr: string, secStr?: string) => {
    const ch = parseInt(chStr)
    if (ch === currentCh) {
      return secStr ? `href="#ch${ch}${secStr}"` : `href="#ch${ch}"`
    }
    const filename = `ch${pad(ch)}.html`
    return secStr ? `href="${filename}#ch${ch}${secStr}"` : `href="${filename}#ch${ch}"`
  })
}
