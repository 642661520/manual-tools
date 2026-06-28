import { describe, it, expect } from 'vitest'
import { buildSidebarHtml } from '../services/site-builder/sidebar.js'

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

const featureB = {
  id: 'feat-b',
  title: '功能 B',
  description: '',
  sections: [{ key: '_default', title: '默认' }],
  is_custom: 0,
  category_id: null,
  project_id: 'default',
}

describe('buildSidebarHtml', () => {
  it('无 Part 时生成章节列表', () => {
    const html = buildSidebarHtml([featureA], [], false)
    expect(html).toContain('功能 A')
    expect(html).toContain('ch01.html')
    expect(html).toContain('简介')
    expect(html).toContain('用法')
  })

  it('叶子章节输出链接而非按钮', () => {
    const html = buildSidebarHtml([featureB], [], false)
    expect(html).toContain('功能 B')
    expect(html).toContain('ch01.html')
    // 叶子章节用 a 链接，不用 button
    expect(html).toContain('<a href="ch01.html"')
  })

  it('当前章节添加 active class', () => {
    const html = buildSidebarHtml([featureA], [], false, 1)
    expect(html).toContain('active')
  })

  it('有 Part 时生成分组结构', () => {
    const parts = [{ title: '第一组', idx: 1, featureIds: ['feat-a'] }]
    const html = buildSidebarHtml([featureA], parts, true)
    expect(html).toContain('第一组')
    expect(html).toContain('vp-nav-part')
  })

  it('空列表返回空字符串', () => {
    expect(buildSidebarHtml([], [], false)).toBe('')
  })
})
