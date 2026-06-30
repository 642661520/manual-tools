import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { Awareness } from 'y-protocols/awareness'

interface UserState {
  user?: { name: string; color: string }
  cursor?: { anchor: unknown; head: unknown } | null
}

export const CursorAwareness = (awareness: Awareness) => {
  const cursorPluginKey = new PluginKey('collaboration-cursor')
  let awarenessHandler:
    | ((changes: { added: number[]; updated: number[]; removed: number[] }) => void)
    | null = null

  return Extension.create({
    name: 'cursorAwareness',

    onCreate() {
      awarenessHandler = (changes) => {
        const { added, updated, removed } = changes
        const allChanges = [...added, ...updated, ...removed]
        // 如果只有本地客户端变化（自己的光标同步），跳过，避免用 awareness 中的旧位置
        // 覆盖 apply 中通过 tr.mapping 正确映射后的远程光标装饰器
        if (allChanges.length === 1 && allChanges[0] === awareness.clientID) return

        const view = this.editor.view
        requestAnimationFrame(() => {
          if (!view.isDestroyed) {
            view.dispatch(view.state.tr.setMeta(cursorPluginKey, {}))
          }
        })
      }
      awareness.on('update', awarenessHandler)
    },

    onDestroy() {
      if (awarenessHandler) {
        awareness.off('update', awarenessHandler)
        awarenessHandler = null
      }
    },

    addProseMirrorPlugins() {
      function createDecorations(state: EditorState) {
        if (!state?.doc) return DecorationSet.empty
        const decorations: Decoration[] = []
        const localClientId = awareness.clientID

        awareness.getStates().forEach((userState: UserState, clientId: number) => {
          // 排除本地客户端的自己
          if (clientId === localClientId) return
          if (!userState.user || !userState.cursor) return

          const { name, color } = userState.user
          const { anchor } = userState.cursor
          if (anchor == null) return

          try {
            const pos = Math.min(anchor as number, state.doc.content.size)

            const cursorEl = document.createElement('span')
            cursorEl.className = 'collaboration-cursor__caret'
            cursorEl.style.borderColor = color

            const labelEl = document.createElement('div')
            labelEl.className = 'collaboration-cursor__label'
            labelEl.style.backgroundColor = color
            labelEl.textContent = name
            cursorEl.appendChild(labelEl)

            decorations.push(Decoration.widget(pos, cursorEl, { clientId: String(clientId) }))
          } catch {
            // invalid position
          }
        })

        return DecorationSet.create(state.doc, decorations)
      }

      return [
        new Plugin({
          key: cursorPluginKey,
          state: {
            init(_, state) {
              return createDecorations(state)
            },
            apply(tr, old, _oldState, newState) {
              // 远程 awareness 变化：从 awareness 重新读取光标位置
              if (tr.getMeta(cursorPluginKey)) {
                return createDecorations(newState)
              }
              // 本地编辑导致文档变化：将已有装饰器位置通过 transaction 映射到新文档
              // 这样远程光标位置会随本地插入/删除自动调整
              if (tr.docChanged) {
                return old.map(tr.mapping, tr.doc)
              }
              return old
            },
          },
          props: {
            decorations(state) {
              return cursorPluginKey.getState(state)
            },
          },
        }),
      ]
    },
  })
}
