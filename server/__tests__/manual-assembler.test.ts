import { describe, it, expect } from 'vitest'
import { headingId, extractChapterMarkdown } from '../services/manual-assembler.js'

describe('headingId', () => {
  it('转为小写并用连字符替换空格', () => {
    expect(headingId('Hello World')).toBe('hello-world')
  })

  it('中文不变', () => {
    expect(headingId('操作手册')).toBe('操作手册')
  })

  it('多个空格合并为单个连字符', () => {
    expect(headingId('a  b')).toBe('a-b')
  })
})

describe('extractChapterMarkdown', () => {
  const fullMarkdown = [
    '<a id="ch1"></a>',
    '# 第一章',
    '内容 A',
    '',
    '<a id="ch2"></a>',
    '# 第二章',
    '内容 B',
    '',
    '<a id="ch3"></a>',
    '# 第三章',
    '内容 C',
  ].join('\n')

  it('提取第一章', () => {
    const ch1 = extractChapterMarkdown(fullMarkdown, 1)
    expect(ch1).toContain('# 第一章')
    expect(ch1).toContain('内容 A')
    expect(ch1).not.toContain('第二章')
  })

  it('提取中间章节', () => {
    const ch2 = extractChapterMarkdown(fullMarkdown, 2)
    expect(ch2).toContain('# 第二章')
    expect(ch2).toContain('内容 B')
  })

  it('提取最后一章', () => {
    const ch3 = extractChapterMarkdown(fullMarkdown, 3)
    expect(ch3).toContain('# 第三章')
    expect(ch3).toContain('内容 C')
  })

  it('不存在的章节返回 null', () => {
    expect(extractChapterMarkdown(fullMarkdown, 99)).toBeNull()
  })
})
