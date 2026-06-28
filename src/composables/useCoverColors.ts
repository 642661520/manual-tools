/**
 * 封面配色工具 — 基于标题 hash 生成一致的封面颜色方案
 *
 * 用于书架封面、预览 Hero Banner、静态站封面等场景。
 * 相同的标题总是产生相同的配色，保证视觉一致性。
 */

export function getTitleHash(title: string): number {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash << 5) - hash + title.charCodeAt(i)
    hash |= 0 // Convert to 32bit integer
  }
  return Math.abs(hash % 360)
}

export interface CoverColors {
  /** 基础色 (hsl) */
  bg: string
  /** 对角渐变 (135deg, 亮→暗) */
  gradient: string
  /** 书脊渐变 (垂直, 更暗更饱和) */
  spine: string
  /** 顶部装饰条渐变 */
  accent: string
}

export function getCoverColors(hue: number): CoverColors {
  return {
    bg: `hsl(${hue}, 50%, 42%)`,
    gradient: `linear-gradient(135deg, hsl(${hue}, 55%, 50%) 0%, hsl(${hue}, 50%, 42%) 50%, hsl(${hue}, 45%, 34%) 100%)`,
    spine: `linear-gradient(180deg, hsl(${hue}, 48%, 36%) 0%, hsl(${hue}, 50%, 28%) 100%)`,
    accent: `linear-gradient(90deg, hsl(${hue}, 55%, 55%) 0%, rgba(255,255,255,0.12) 80%, transparent 100%)`,
  }
}
