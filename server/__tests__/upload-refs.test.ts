import { describe, it, expect } from 'vitest'
import {
  extractUploadRefsFromHtml,
  extractUploadRefsFromBlob,
  absoluteToRelativeUploadPaths,
  relativeToAbsoluteUploadPaths,
  parseRelativeUploadRef,
} from '../lib/upload-refs.js'

const HASH64 = 'a'.repeat(64)

describe('extractUploadRefsFromHtml', () => {
  it('应提取单个 /uploads/images/ 引用并去除前缀', () => {
    const html = `<img src="/uploads/images/ab/${HASH64}.png" />`
    const refs = extractUploadRefsFromHtml(html)
    expect(refs).toEqual([`images/ab/${HASH64}.png`])
  })

  it('应提取视频引用', () => {
    const html = `<video src="/uploads/videos/cd/${HASH64}.mov" />`
    const refs = extractUploadRefsFromHtml(html)
    expect(refs).toEqual([`videos/cd/${HASH64}.mov`])
  })

  it('应去重相同引用', () => {
    const html = `<img src="/uploads/images/ab/${HASH64}.png" /><img src="/uploads/images/ab/${HASH64}.png" />`
    const refs = extractUploadRefsFromHtml(html)
    expect(refs).toHaveLength(1)
  })

  it('应提取多个不同引用', () => {
    const html = [
      `<img src="/uploads/images/ab/${HASH64}.png" />`,
      `<img src="/uploads/images/cd/${'b'.repeat(64)}.jpg" />`,
    ].join('\n')
    const refs = extractUploadRefsFromHtml(html)
    expect(refs).toHaveLength(2)
  })

  it('无匹配时返回空数组', () => {
    expect(extractUploadRefsFromHtml('<p>hello</p>')).toEqual([])
    expect(extractUploadRefsFromHtml('')).toEqual([])
  })

  it('不匹配非标准路径格式', () => {
    // 缺少分片目录（2位hex）
    const html = `<img src="/uploads/images/${HASH64}.png" />`
    expect(extractUploadRefsFromHtml(html)).toEqual([])
  })
})

describe('extractUploadRefsFromBlob', () => {
  it('应从 Buffer 中提取引用（委托 extractUploadRefsFromHtml）', () => {
    const buf = Buffer.from(`<img src="/uploads/images/ab/${HASH64}.png" />`, 'utf-8')
    const refs = extractUploadRefsFromBlob(buf)
    expect(refs).toEqual([`images/ab/${HASH64}.png`])
  })

  it('空 Buffer 返回空数组', () => {
    expect(extractUploadRefsFromBlob(Buffer.alloc(0))).toEqual([])
  })
})

describe('absoluteToRelativeUploadPaths', () => {
  it('应将绝对路径转为相对路径', () => {
    const html = `<img src="/uploads/images/ab/${HASH64}.png" />`
    const result = absoluteToRelativeUploadPaths(html)
    expect(result).toBe(`<img src="../../uploads/images/ab/${HASH64}.png" />`)
  })

  it('应转换多个引用', () => {
    const html = [
      `<img src="/uploads/images/ab/${HASH64}.png" />`,
      `<img src="/uploads/images/cd/${'b'.repeat(64)}.jpg" />`,
    ].join('\n')
    const result = absoluteToRelativeUploadPaths(html)
    expect(result).toContain('../../uploads/images/ab/')
    expect(result).toContain('../../uploads/images/cd/')
  })

  it('无匹配时原样返回', () => {
    expect(absoluteToRelativeUploadPaths('<p>hello</p>')).toBe('<p>hello</p>')
  })
})

describe('relativeToAbsoluteUploadPaths', () => {
  it('应将相对路径转为绝对路径（有分片目录）', () => {
    const html = `../../uploads/images/ab/${HASH64}.png`
    const result = relativeToAbsoluteUploadPaths(html)
    expect(result).toBe(`/uploads/images/ab/${HASH64}.png`)
  })

  it('应将相对路径转为绝对路径（无分片目录）', () => {
    const html = `../../uploads/images/myfile.png`
    const result = relativeToAbsoluteUploadPaths(html)
    expect(result).toBe('/uploads/images/myfile.png')
  })

  it('无匹配时原样返回', () => {
    expect(relativeToAbsoluteUploadPaths('<p>hello</p>')).toBe('<p>hello</p>')
  })

  it('应处理视频路径', () => {
    const html = `../../uploads/videos/ab/${HASH64}.mp4`
    const result = relativeToAbsoluteUploadPaths(html)
    expect(result).toBe(`/uploads/videos/ab/${HASH64}.mp4`)
  })
})

describe('parseRelativeUploadRef', () => {
  it('应解析带分片的哈希路径', () => {
    const result = parseRelativeUploadRef(`../../uploads/images/ab/${HASH64}.png`)
    expect(result).toEqual({
      zipPath: `uploads/images/ab/${HASH64}.png`,
      filename: `${HASH64}.png`,
      isHashed: true,
    })
  })

  it('应解析无分片的普通文件名', () => {
    const result = parseRelativeUploadRef('../../uploads/images/myfile.png')
    expect(result).toEqual({
      zipPath: 'uploads/images/myfile.png',
      filename: 'myfile.png',
      isHashed: false,
    })
  })

  it('非 64 位 hex 文件名标记 isHashed=false', () => {
    const result = parseRelativeUploadRef('../../uploads/images/ab/short.png')
    expect(result).toEqual({
      zipPath: 'uploads/images/ab/short.png',
      filename: 'short.png',
      isHashed: false,
    })
  })

  it('不匹配非 uploads 路径应返回 null', () => {
    expect(parseRelativeUploadRef('/some/other/path.png')).toBeNull()
    expect(parseRelativeUploadRef('')).toBeNull()
    expect(parseRelativeUploadRef('../../assets/image.png')).toBeNull()
  })

  it('应处理视频路径', () => {
    const result = parseRelativeUploadRef(`../../uploads/videos/ab/${HASH64}.mov`)
    expect(result).toEqual({
      zipPath: `uploads/videos/ab/${HASH64}.mov`,
      filename: `${HASH64}.mov`,
      isHashed: true,
    })
  })
})
