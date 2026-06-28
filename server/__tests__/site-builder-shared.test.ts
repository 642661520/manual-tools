import { describe, it, expect } from 'vitest'
import {
  escHtml,
  stripHtml,
  slugify,
  pad,
  buildFeaturePartMap,
  rewriteCrossLinks,
} from '../services/site-builder/shared.js'

describe('escHtml', () => {
  it('转义 &', () => {
    expect(escHtml('a & b')).toBe('a &amp; b')
  })

  it('转义 < >', () => {
    expect(escHtml('<script>')).toBe('&lt;script&gt;')
  })

  it('转义双引号', () => {
    expect(escHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  it('安全文本不变', () => {
    expect(escHtml('hello world')).toBe('hello world')
  })
})

describe('stripHtml', () => {
  it('去除 HTML 标签', () => {
    expect(stripHtml('<p>Hello <strong>World</strong></p>')).toContain('Hello')
    expect(stripHtml('<p>Hello <strong>World</strong></p>')).toContain('World')
  })

  it('解码 HTML 实体', () => {
    expect(stripHtml('&amp; &lt; &gt; &quot;')).toBe('& < > "')
  })

  it('合并多余空白', () => {
    const result = stripHtml('<div>  a   b  </div>')
    expect(result).toBe('a b')
  })
})

describe('slugify', () => {
  it('英文转小写并替换空格为连字符', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('保留中文', () => {
    expect(slugify('操作手册')).toBe('操作手册')
  })

  it('去除特殊字符', () => {
    expect(slugify('Hello! @World #2024')).toBe('hello-world-2024')
  })

  it('截断超过 64 字符', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long).length).toBeLessThanOrEqual(64)
  })

  it('空字符串返回 heading', () => {
    expect(slugify('')).toBe('heading')
  })

  it('纯特殊字符返回 heading', () => {
    expect(slugify('!@#$')).toBe('heading')
  })
})

describe('pad', () => {
  it('个位数补零', () => {
    expect(pad(1)).toBe('01')
    expect(pad(9)).toBe('09')
  })

  it('两位数不变', () => {
    expect(pad(10)).toBe('10')
    expect(pad(99)).toBe('99')
  })
})

describe('buildFeaturePartMap', () => {
  it('单个 part 映射', () => {
    const parts = [{ title: 'Part 1', idx: 1, featureIds: ['feat-a', 'feat-b'] }]
    const map = buildFeaturePartMap(parts)
    expect(map.get('feat-a')).toEqual({ title: 'Part 1', idx: 1, featureIds: ['feat-a', 'feat-b'] })
    expect(map.get('feat-b')).toEqual({ title: 'Part 1', idx: 1, featureIds: ['feat-a', 'feat-b'] })
  })

  it('多个 part 映射', () => {
    const parts = [
      { title: 'Part 1', idx: 1, featureIds: ['feat-a'] },
      { title: 'Part 2', idx: 2, featureIds: ['feat-b', 'feat-c'] },
    ]
    const map = buildFeaturePartMap(parts)
    expect(map.get('feat-a')?.title).toBe('Part 1')
    expect(map.get('feat-b')?.title).toBe('Part 2')
    expect(map.get('feat-c')?.title).toBe('Part 2')
  })

  it('空 parts 返回空 Map', () => {
    expect(buildFeaturePartMap([]).size).toBe(0)
  })
})

describe('rewriteCrossLinks', () => {
  it('同章链接保留 hash', () => {
    const html = '<a href="#ch3-s2">链接</a>'
    const result = rewriteCrossLinks(html, 3)
    expect(result).toBe('<a href="#ch3-s2">链接</a>')
  })

  it('异章链接改为跨页', () => {
    const html = '<a href="#ch5-s2">链接</a>'
    const result = rewriteCrossLinks(html, 3)
    expect(result).toBe('<a href="ch05.html#ch5-s2">链接</a>')
  })

  it('无 section 的同章链接保留', () => {
    const html = '<a href="#ch3">链接</a>'
    const result = rewriteCrossLinks(html, 3)
    expect(result).toBe('<a href="#ch3">链接</a>')
  })

  it('无 section 的异章链接改为跨页', () => {
    const html = '<a href="#ch5">链接</a>'
    const result = rewriteCrossLinks(html, 3)
    expect(result).toBe('<a href="ch05.html#ch5">链接</a>')
  })

  it('多个链接全部处理', () => {
    const html = '<a href="#ch1">A</a> <a href="#ch2-s1">B</a>'
    const result = rewriteCrossLinks(html, 1)
    expect(result).toBe('<a href="#ch1">A</a> <a href="ch02.html#ch2-s1">B</a>')
  })
})
