/** 共享工具函数 — Section 解析 */

export interface SectionDef {
  key: string
  title: string
  description?: string
}

/** 将 sections 的 JSON 字符串或数组统一解析为数组 */
export function parseSections(sections: string | SectionDef[]): SectionDef[] {
  if (Array.isArray(sections)) return sections
  try {
    const parsed = JSON.parse(sections || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
