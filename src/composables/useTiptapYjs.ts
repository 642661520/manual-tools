import { ref } from 'vue'
import { useEditor } from '@tiptap/vue-3'
import { StarterKit } from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TextAlign } from '@tiptap/extension-text-align'
import { Underline } from '@tiptap/extension-underline'
import { CharacterCount } from '@tiptap/extension-character-count'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'

const ExitableSubscript = Subscript.extend({ exitable: true })
const ExitableSuperscript = Superscript.extend({ exitable: true })

// 扩展 Image，支持 imgStyle 属性用于尺寸调整
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      imgStyle: {
        default: null,
        parseHTML: element => element.getAttribute('style'),
        renderHTML(attributes) {
          if (!attributes.imgStyle) return {}
          return { style: attributes.imgStyle as string }
        },
      },
    }
  },
})
import { CursorAwareness } from './cursor-awareness'
import { Crossref } from './crossref-node'
import { SearchHighlight } from './search-highlight'
import { MarkdownPaste } from './markdown-paste'
import { Video } from './video-node'
import { DOMParser } from '@tiptap/pm/model'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

export function useTiptapYjs(
  ydoc: Y.Doc,
  awareness: Awareness,
  options?: { placeholder?: string; editable?: boolean },
) {
  const ytext = ydoc.getText('content')
  let lastSyncedHtml = ytext.toString() || ''
  let applyingRemote = false
  let syncTimeoutId: ReturnType<typeof setTimeout> | null = null
  let syncRafId: number | null = null

  /** 将本地编辑去抖后同步到 Yjs（合并 200ms 内的连续编辑，减少全量替换次数） */
  function syncToYjs() {
    if (applyingRemote) return
    // 用 requestAnimationFrame 批量合并同帧内的多次更新
    if (syncRafId === null) {
      syncRafId = requestAnimationFrame(() => {
        syncRafId = null
        flushSync()
      })
    }
    // 兜底：超过 200ms 强制同步
    if (!syncTimeoutId) {
      syncTimeoutId = setTimeout(() => {
        syncTimeoutId = null
        if (syncRafId !== null) {
          cancelAnimationFrame(syncRafId)
          syncRafId = null
        }
        flushSync()
      }, 200)
    }
  }

  function flushSync() {
    const ed = editor.value
    if (!ed) return
    const html = ed.getHTML()
    if (html === lastSyncedHtml) return
    lastSyncedHtml = html
    Y.transact(ydoc, () => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, html)
    }, 'local')
  }

  const editor = useEditor({
    content: lastSyncedHtml || undefined,
    editable: options?.editable ?? true,
    extensions: [
      StarterKit,
      ResizableImage,
      Video,
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      CharacterCount,
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      ExitableSubscript,
      ExitableSuperscript,
      Placeholder.configure({
        placeholder: options?.placeholder || '开始编写操作手册内容...',
      }),
      Crossref,
      SearchHighlight,
      MarkdownPaste,
      CursorAwareness(awareness),
    ],
    editorProps: {
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false

        // 查找剪贴板中的图片
        const imageItems: DataTransferItem[] = []
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item.type.startsWith('image/')) {
            imageItems.push(item)
          }
        }

        if (imageItems.length === 0) return false

        // 阻止默认粘贴，改为上传后插入
        event.preventDefault()

        const { tr } = view.state
        const pos = view.state.selection.anchor
        const placeholder = '[图片上传中...] '

        // 先插入一个加载占位文本
        view.dispatch(tr.insertText(placeholder, pos))

        ;(async () => {
          const endPos = pos + placeholder.length
          try {
            // 优先从 items 取，fallback 到 files
            let blob: Blob | null = imageItems[0].getAsFile()
            if (!blob) {
              blob = event.clipboardData?.files[0] || null
            }
            if (!blob) {
              throw new Error('无法读取剪贴板图片')
            }

            const { uploadImage } = await import('@/api/endpoints/upload')
            const { url } = await uploadImage(blob)

            const ed = editor.value
            if (!ed) return
            ed.chain()
              .setTextSelection({ from: pos, to: endPos })
              .deleteSelection()
              .setImage({ src: url })
              .run()
          } catch {
            const ed = editor.value
            if (!ed) return
            ed.chain()
              .setTextSelection({ from: pos, to: endPos })
              .deleteSelection()
              .insertContent('[图片上传失败] ')
              .run()
          }
        })()

        return true
      },
    },
    onSelectionUpdate() {
      if (applyingRemote) return
      scheduleCursorSync()
    },
    onUpdate() {
      syncToYjs()
    },
  })

  // 光标防抖
  let cursorTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleCursorSync() {
    if (cursorTimer) return
    cursorTimer = setTimeout(() => {
      cursorTimer = null
      if (!editor.value) return
      const sel = editor.value.state.selection
      awareness.setLocalStateField('cursor', {
        anchor: sel.anchor,
        head: sel.head,
      })
    }, 100)
  }

  // 远程更新 → replaceWith + dispatch
  const initialSyncDone = ref(false)
  const updateHandler = (_update: Uint8Array, origin: unknown) => {
    if (origin === 'local') return
    const ed = editor.value
    if (!ed) return
    const html = ytext.toString()
    if (!html || html === ed.getHTML()) return

    applyingRemote = true
    if (syncTimeoutId) { clearTimeout(syncTimeoutId); syncTimeoutId = null }
    if (syncRafId) { cancelAnimationFrame(syncRafId); syncRafId = null }
    if (cursorTimer) { clearTimeout(cursorTimer); cursorTimer = null }

    // 保存光标上下文（文本前后各取 50 字符），用于替换后恢复到相同逻辑位置
    const savedAnchor = ed.state.selection.anchor
    let cursorContext: { before: string; after: string } | null = null
    try {
      const $pos = ed.state.doc.resolve(savedAnchor)
      const parentText = $pos.parent.textContent
      const offset = $pos.parentOffset
      cursorContext = {
        before: parentText.substring(Math.max(0, offset - 50), offset),
        after: parentText.substring(offset, Math.min(parentText.length, offset + 50)),
      }
    } catch { /* ignore */ }

    const parser = DOMParser.fromSchema(ed.state.schema)
    const element = document.createElement('div')
    element.innerHTML = html
    const doc = parser.parse(element)
    const tr = ed.state.tr.replaceWith(0, ed.state.doc.content.size, doc.content)
    if (!initialSyncDone.value) {
      tr.setMeta('addToHistory', false)
      initialSyncDone.value = true
    }
    ed.view.dispatch(tr)

    // 通过文本上下文恢复光标到相同逻辑位置（而非原始绝对位置）
    let restored = false
    if (cursorContext) {
      const searchText = cursorContext.before + cursorContext.after
      ed.state.doc.descendants((node, pos) => {
        if (node.isText && node.text!.includes(searchText)) {
          const idx = node.text!.indexOf(searchText)
          ed.commands.setTextSelection(pos + idx + cursorContext!.before.length)
          restored = true
          return false // 找到即停止
        }
      })
    }
    if (!restored) {
      // 回退：文本上下文匹配失败时使用原始绝对位置
      try {
        const pos = Math.min(savedAnchor, ed.state.doc.content.size)
        if (pos > 0) ed.commands.setTextSelection(pos)
      } catch { /* ignore */ }
    }

    lastSyncedHtml = html
    applyingRemote = false
  }
  ydoc.on('update', updateHandler)

  return { editor, initialSyncDone }
}