import { describe, it, expect, vi } from 'vitest'
import { yjsDataToHtml, htmlToYjsSnapshot } from '../lib/yjs-utils.js'
import * as Y from 'yjs'

describe('yjsDataToHtml', () => {
  it('应解码 snapshot 为 HTML', () => {
    const ydoc = new Y.Doc()
    ydoc.getText('content').insert(0, '<p>Hello World</p>')
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc))
    ydoc.destroy()

    const html = yjsDataToHtml(snapshot, [])
    expect(html).toBe('<p>Hello World</p>')
  })

  it('应合并 snapshot + updates 为最终 HTML', () => {
    // 创建初始 snapshot
    const ydoc1 = new Y.Doc()
    ydoc1.getText('content').insert(0, '<p>Version 1</p>')
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc1))
    ydoc1.destroy()

    // 创建增量 update
    const ydoc2 = new Y.Doc()
    Y.applyUpdate(ydoc2, new Uint8Array(snapshot))
    ydoc2.getText('content').insert(0, '[PREFIX] ')
    const update = Buffer.from(Y.encodeStateAsUpdate(ydoc2))
    ydoc2.destroy()

    const html = yjsDataToHtml(snapshot, [update])
    expect(html).toBe('[PREFIX] <p>Version 1</p>')
  })

  it('snapshot 为 null 时仅用 updates 解码', () => {
    const ydoc = new Y.Doc()
    ydoc.getText('content').insert(0, '<p>From update only</p>')
    const update = Buffer.from(Y.encodeStateAsUpdate(ydoc))
    ydoc.destroy()

    const html = yjsDataToHtml(null, [update])
    expect(html).toBe('<p>From update only</p>')
  })

  it('snapshot 和 updates 均为空时返回空字符串', () => {
    expect(yjsDataToHtml(null, [])).toBe('')
  })

  it('损坏的 snapshot 应被跳过并输出 warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const html = yjsDataToHtml(Buffer.from('corrupted data'), [])
    expect(html).toBe('')
    expect(warnSpy).toHaveBeenCalledWith('[yjs-utils] 快照数据损坏，已跳过')

    warnSpy.mockRestore()
  })

  it('损坏的 update 应被跳过并输出 warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // 有效的 snapshot + 损坏的 update
    const ydoc = new Y.Doc()
    ydoc.getText('content').insert(0, '<p>OK</p>')
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc))
    ydoc.destroy()

    const html = yjsDataToHtml(snapshot, [Buffer.from('bad update')])
    expect(html).toBe('<p>OK</p>')
    expect(warnSpy).toHaveBeenCalledWith('[yjs-utils] 增量数据损坏，已跳过')

    warnSpy.mockRestore()
  })

  it('应处理中文内容', () => {
    const ydoc = new Y.Doc()
    ydoc.getText('content').insert(0, '<p>你好世界</p>')
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc))
    ydoc.destroy()

    const html = yjsDataToHtml(snapshot, [])
    expect(html).toBe('<p>你好世界</p>')
  })
})

describe('htmlToYjsSnapshot', () => {
  it('应将 HTML 编码为可解码的 Y.js Buffer', () => {
    const html = '<p>Hello World</p>'
    const buffer = htmlToYjsSnapshot(html)

    // 验证返回的是 Buffer
    expect(Buffer.isBuffer(buffer)).toBe(true)

    // 往返验证：编码后再解码应一致
    const decoded = yjsDataToHtml(buffer, [])
    expect(decoded).toBe(html)
  })

  it('应处理空 HTML', () => {
    const buffer = htmlToYjsSnapshot('')
    expect(Buffer.isBuffer(buffer)).toBe(true)
    const decoded = yjsDataToHtml(buffer, [])
    expect(decoded).toBe('')
  })

  it('应处理富文本 HTML', () => {
    const html = '<h1>Title</h1><p>Paragraph with <strong>bold</strong></p><ul><li>Item</li></ul>'
    const buffer = htmlToYjsSnapshot(html)
    const decoded = yjsDataToHtml(buffer, [])
    expect(decoded).toBe(html)
  })

  it('应处理包含图片标签的 HTML', () => {
    const html = '<p>Text</p><img src="/uploads/images/ab/hash.png" alt="pic" />'
    const buffer = htmlToYjsSnapshot(html)
    const decoded = yjsDataToHtml(buffer, [])
    expect(decoded).toBe(html)
  })

  it('应处理中文内容', () => {
    const html = '<p>你好世界！<strong>注意事项</strong></p>'
    const buffer = htmlToYjsSnapshot(html)
    const decoded = yjsDataToHtml(buffer, [])
    expect(decoded).toBe(html)
  })
})
