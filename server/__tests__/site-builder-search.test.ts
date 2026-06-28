import { describe, it, expect } from 'vitest'
import { stripHtml, buildSearchIndex } from '../services/site-builder/search.ts'

describe('stripHtml (search)', () => {
  it('剥离 HTML 标签', () => {
    expect(stripHtml('<p>Hello World</p>')).toBe('Hello World')
  })

  it('解码 HTML 实体', () => {
    expect(stripHtml('a &amp; b')).toBe('a & b')
  })

  it('合并多余空白', () => {
    expect(stripHtml('<div>  a   b  </div>')).toBe('a b')
  })
})

describe('buildSearchIndex', () => {
  const featureA = {
    id: 'feat-a',
    title: '功能 A',
    description: '描述 A',
    sections: [{ key: 'intro', title: '简介' }, { key: 'usage', title: '用法' }],
    is_custom: 0,
    category_id: null,
    project_id: 'default',
  }

  const featureB = {
    id: 'feat-b',
    title: '功能 B',
    description: '',
    sections: [{ key: '_default', title: '默认' }],
    is_custom: 0,
    category_id: null,
    project_id: 'default',
  }

  it('多 section 功能生成章节级 + section 级 entry', () => {
    const pages = new Map<number, Array<{ id: string; title: string; content: string }>>()
    pages.set(1, [
      { id: 'p1', title: '简介', content: '<p>intro content</p>' },
      { id: 'p2', title: '用法', content: '<p>usage content</p>' },
    ])

    const result = buildSearchIndex([featureA], pages)
    expect(result.entries.length).toBe(3) // 章节级 + 2个 section

    const chapters = result.entries.filter((e) => e.secNum === 0)
    expect(chapters).toHaveLength(1)
    expect(chapters[0].chapter).toBe('功能 A')
    expect(chapters[0].url).toBe('ch01.html')
  })

  it('叶子章节只生成一条 entry', () => {
    const pages = new Map<number, Array<{ id: string; title: string; content: string }>>()
    pages.set(1, [{ id: 'p1', title: '默认', content: '<p>leaf content</p>' }])

    const result = buildSearchIndex([featureB], pages)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].chapter).toBe('功能 B')
    expect(result.entries[0].secNum).toBe(0)
  })

  it('无 pages 时仅使用标题和描述', () => {
    const result = buildSearchIndex([featureA], new Map())
    // 章节级 + 2 个 section（使用标题和描述，无内容）
    expect(result.entries.length).toBe(3)
    expect(result.entries[0].text).toContain('功能 A')
    expect(result.entries[0].text).toContain('描述 A')
  })

  it('多个功能按顺序编号', () => {
    const pages = new Map<number, Array<{ id: string; title: string; content: string }>>()
    pages.set(1, [{ id: 'p1', title: '默认', content: '' }])
    pages.set(2, [{ id: 'p2', title: '默认', content: '' }])

    const result = buildSearchIndex([featureB, featureB], pages)
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].url).toBe('ch01.html')
    expect(result.entries[1].url).toBe('ch02.html')
  })
})
