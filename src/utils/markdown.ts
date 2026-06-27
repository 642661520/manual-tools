/** Markdown 渲染工具 — 基于 markdown-it */
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: true, // 需要保留服务端生成的 <a class="crossref-link"> 等内联 HTML
  linkify: true, // 自动识别 URL 并转为链接
  typographer: true, // 美化引号、破折号等
})

/** 将 Markdown 文本渲染为 HTML */
export function renderMarkdown(mdText: string): string {
  if (!mdText) return '<p class="text-gray-400 italic">（暂未编写）</p>'
  return md.render(mdText)
}
