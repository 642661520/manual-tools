/** site-builder 内部共享类型和工具 */

export interface SitePage {
  id: string
  title: string
  content: string  // HTML
}

export interface PartMeta {
  title: string
  idx: number      // 1-based part index
  featureIds: string[]
}

export interface TocItem {
  level: number    // 1=chapter, 2=section, 3=h2 sub-heading, 4=h3 sub-heading
  id: string       // anchor id
  title: string
}

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w一-鿿\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'heading'
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 构建 featureId → part 映射 */
export function buildFeaturePartMap(parts: PartMeta[]): Map<string, { title: string; idx: number; featureIds: string[] }> {
  const map = new Map<string, { title: string; idx: number; featureIds: string[] }>()
  for (const part of parts) {
    for (const fid of part.featureIds) {
      map.set(fid, { title: part.title, idx: part.idx, featureIds: part.featureIds })
    }
  }
  return map
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
