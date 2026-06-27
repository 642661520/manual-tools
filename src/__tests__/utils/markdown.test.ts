/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '@/utils/markdown'

describe('renderMarkdown', () => {
  it('空字符串返回占位文本', () => {
    const result = renderMarkdown('')
    expect(result).toContain('暂未编写')
  })

  it('渲染标题', () => {
    const result = renderMarkdown('# 一级标题\n## 二级标题')
    expect(result).toContain('<h1>一级标题</h1>')
    expect(result).toContain('<h2>二级标题</h2>')
  })

  it('渲染粗体和斜体', () => {
    const result = renderMarkdown('**粗体** 和 *斜体*')
    expect(result).toContain('<strong>粗体</strong>')
    expect(result).toContain('<em>斜体</em>')
  })

  it('渲染链接', () => {
    const result = renderMarkdown('[示例](https://example.com)')
    expect(result).toContain('<a href="https://example.com">示例</a>')
  })

  it('渲染表格', () => {
    const result = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(result).toContain('<table>')
    expect(result).toContain('<th>A</th>')
    expect(result).toContain('<td>1</td>')
  })

  it('渲染代码块', () => {
    const result = renderMarkdown('```ts\nconst a = 1\n```')
    expect(result).toContain('<pre>')
    expect(result).toContain('<code')
    expect(result).toContain('language-ts')
  })

  it('渲染引用块', () => {
    const result = renderMarkdown('> 引用文字')
    expect(result).toContain('<blockquote>')
  })

  it('保留 HTML（crossref 链接）', () => {
    const result = renderMarkdown('<a class="crossref-link" href="#ch3-s2">链接</a>')
    expect(result).toContain('crossref-link')
    expect(result).toContain('href="#ch3-s2"')
  })
})
