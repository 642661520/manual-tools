import { describe, it, expect } from 'vitest'
import { parseSections } from '@shared/utils/sections'

describe('parseSections', () => {
  it('数组原样返回', () => {
    const input = [
      { key: 'intro', title: '简介' },
      { key: 'usage', title: '用法', description: '使用说明' },
    ]
    expect(parseSections(input)).toBe(input) // 同一个引用
  })

  it('空数组返回空数组', () => {
    expect(parseSections([])).toEqual([])
  })

  it('有效 JSON 字符串解析为数组', () => {
    const json = JSON.stringify([
      { key: 'intro', title: '简介' },
      { key: 'usage', title: '用法' },
    ])
    expect(parseSections(json)).toEqual([
      { key: 'intro', title: '简介' },
      { key: 'usage', title: '用法' },
    ])
  })

  it('空字符串 fallback 到空数组', () => {
    expect(parseSections('')).toEqual([])
  })

  it('null JSON 返回空数组', () => {
    expect(parseSections('null')).toEqual([])
  })

  it('非数组 JSON（数字/字符串/布尔）返回空数组', () => {
    expect(parseSections('42')).toEqual([])
    expect(parseSections('"hello"')).toEqual([])
    expect(parseSections('true')).toEqual([])
  })

  it('undefined 值 fallback 到空数组', () => {
    expect(parseSections(undefined as unknown as string)).toEqual([])
  })

  it('非法 JSON fallback 到空数组', () => {
    expect(parseSections('{invalid')).toEqual([])
    expect(parseSections('not json at all')).toEqual([])
  })

  it('应保留 description 字段', () => {
    const input = [{ key: 'a', title: 'A', description: 'desc' }]
    expect(parseSections(input)).toEqual([{ key: 'a', title: 'A', description: 'desc' }])
  })
})
