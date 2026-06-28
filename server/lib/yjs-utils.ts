// ============================================================
// Y.js 编解码工具
// HTML ↔ Y.js binary 的通用转换，供 export/import/seed/search 等模块复用
// ============================================================

import * as Y from 'yjs'

/**
 * 将 Y.js snapshot + 增量 updates 解码为 HTML 文本
 * @param snapshot 最新快照 BLOB（可为 null）
 * @param updates 增量更新 BLOB 数组
 */
export function yjsDataToHtml(snapshot: Buffer | null, updates: Buffer[]): string {
  const ydoc = new Y.Doc()
  if (snapshot) {
    try {
      Y.applyUpdate(ydoc, new Uint8Array(snapshot))
    } catch {
      console.warn('[yjs-utils] 快照数据损坏，已跳过')
    }
  }
  for (const u of updates) {
    try {
      Y.applyUpdate(ydoc, new Uint8Array(u))
    } catch {
      console.warn('[yjs-utils] 增量数据损坏，已跳过')
    }
  }
  const html = ydoc.getText('content').toString()
  ydoc.destroy()
  return html
}

/**
 * 将 HTML 文本编码为 Y.js snapshot Buffer
 * 用于导入时将 HTML 文档转换为数据库可存储的 Y.js 二进制格式
 */
export function htmlToYjsSnapshot(html: string): Buffer {
  const ydoc = new Y.Doc()
  ydoc.getText('content').insert(0, html)
  const state = Y.encodeStateAsUpdate(ydoc)
  ydoc.destroy()
  return Buffer.from(state)
}
