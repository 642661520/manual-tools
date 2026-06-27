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

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 中文数字（1-20），超出返回数字字符串 */
export function toChineseNumber(n: number): string {
  const map = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
  return map[n - 1] || String(n)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export { pad }

/** 构建 featureId → part 映射 */
export function buildFeaturePartMap(parts: PartMeta[]): Map<string, { title: string; idx: number } | null> {
  const map = new Map<string, { title: string; idx: number } | null>()
  for (const part of parts) {
    for (const fid of part.featureIds) {
      map.set(fid, { title: part.title, idx: part.idx })
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
