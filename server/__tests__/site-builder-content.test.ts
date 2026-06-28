import { describe, it, expect } from 'vitest'
import { buildCoverContentHtml, buildTocHtml } from '../services/site-builder/content.js'

const featureA = {
  id: 'feat-a',
  title: '功能 A',
  description: '',
  sections: [
    { key: 'intro', title: '简介' },
    { key: 'usage', title: '用法' },
  ],
  is_custom: 0,
  category_id: null,
  project_id: 'default',
}

describe('buildCoverContentHtml', () => {
  it('无 Part 时生成封面 HTML', () => {
    const html = buildCoverContentHtml([featureA], [], false, '测试手册', '')
    expect(html).toContain('测试手册')
    expect(html).toContain('功能 A')
    expect(html).toContain('ch01.html')
    expect(html).toContain('简介')
    expect(html).toContain('用法')
  })

  it('有 Part 时生成分组目录', () => {
    const parts = [{ title: '第一组', idx: 1, featureIds: ['feat-a'] }]
    const html = buildCoverContentHtml([featureA], parts, true, '测试', 'v1.0')
    expect(html).toContain('第一组')
    expect(html).toContain('vp-toc-part')
  })

  it('空 features 生成最简封面', () => {
    const html = buildCoverContentHtml([], [], false, '空手册', '')
    expect(html).toContain('空手册')
    expect(html).toContain('vp-cover')
  })
})

describe('buildTocHtml', () => {
  it('无 Part 生成章节目录 HTML', () => {
    const pages = [{ id: 'feat-a', title: '功能 A', content: '<p>A</p>' }]
    const html = buildTocHtml(featureA, 1, pages)
    expect(html).toContain('功能 A')
  })

  it('空 pages 返回基本目录框架', () => {
    const html = buildTocHtml(featureA, 1, [])
    expect(html).toContain('vp-toc')
    expect(html).toContain('功能 A')
  })
})
