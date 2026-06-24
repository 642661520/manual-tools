import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DOMParser, Slice } from '@tiptap/pm/model'
import MarkdownIt from 'markdown-it'

/**
 * 判断纯文本是否包含 Markdown 语法特征，
 * 避免对普通文本误转换。
 */
function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6}\s|^[-*+]\s|^>\s|^```|^---\s*$|^\*\*\*\s*$|^___\s*$|^\|.+\|/m.test(text)
}

/**
 * 粘贴 Markdown 自动转换扩展。
 * 使用 DOM 级 paste 监听在 ProseMirror 之前拦截，
 * 将识别为 Markdown 的纯文本转为富文本后插入。
 */
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const md = new MarkdownIt({ html: false })

    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        view(editorView) {
          function onPaste(event: ClipboardEvent) {
            const text = event.clipboardData?.getData('text/plain')
            if (!text) return

            // 代码块内不转换
            const $from = editorView.state.selection.$from
            if ($from.parent.type.name === 'codeBlock') return

            if (!looksLikeMarkdown(text)) return

            // 若 HTML 含语义标签（网页/Word 富文本），说明渲染版更完整，不做转换
            // 排除 <html> <body> <div> <pre> <span> — 它们是容器/装饰，不代表富文本
            const html = event.clipboardData?.getData('text/html')
            if (html && /<\/?(h[1-6]|p\b|a\b|img|table|ul|ol|blockquote|em|strong)[>\s]/.test(html)) {
              return
            }

            // 拦截粘贴，阻止 ProseMirror 再次处理（stopImmediatePropagation 必须）
            event.preventDefault()
            event.stopImmediatePropagation()

            try {
              let rendered = md.render(text)
              // 修复协议相对 URL（//example.com/img.png → https://example.com/img.png）
              rendered = rendered.replace(/src="\/\//g, 'src="https://')
              const wrapper = document.createElement('div')
              wrapper.innerHTML = rendered

              const doc = DOMParser.fromSchema(editorView.state.schema).parse(wrapper)
              const tr = editorView.state.tr.replaceSelection(new Slice(doc.content, 0, 0))
              editorView.dispatch(tr)
            } catch {
              // 解析失败，回退到默认粘贴（无法触发，忽略）
            }
          }

          // 捕获阶段监听，确保在 ProseMirror 之前拦截
          editorView.dom.addEventListener('paste', onPaste, { capture: true })

          return {
            destroy() {
              editorView.dom.removeEventListener('paste', onPaste, { capture: true })
            },
          }
        },
      }),
    ]
  },
})
