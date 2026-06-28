import { describe, it, expect } from 'vitest'
import { buildCardMessage } from '../services/feishu.js'

describe('buildCardMessage', () => {
  it('基本卡片结构', () => {
    const card = buildCardMessage('标题', '正文内容')
    expect(card.header.title).toEqual({ content: '标题', tag: 'plain_text' })
    expect(card.header.template).toBe('blue') // 默认蓝色
    expect(card.elements).toHaveLength(1)
    expect(card.elements[0]).toEqual({ tag: 'markdown', content: '正文内容' })
  })

  it('自定义颜色', () => {
    const card = buildCardMessage('警告', '内容', { color: 'red' })
    expect(card.header.template).toBe('red')
  })

  it('包含链接按钮', () => {
    const card = buildCardMessage('标题', '内容', {
      link: { url: 'https://example.com', title: '查看详情' },
    })
    expect(card.elements).toHaveLength(2)
    const action = card.elements[1] as { tag: string; actions: Array<Record<string, unknown>> }
    expect(action.tag).toBe('action')
    expect(action.actions[0].tag).toBe('button')
    expect(action.actions[0].text).toEqual({ tag: 'plain_text', content: '查看详情' })
    expect(action.actions[0].url).toBe('https://example.com')
  })

  it('不传 options 使用默认值', () => {
    const card = buildCardMessage('A', 'B')
    expect(card.header.template).toBe('blue')
    expect(card.elements).toHaveLength(1)
  })
})
