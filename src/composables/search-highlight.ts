import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DecorationSet } from '@tiptap/pm/view'

export const searchPluginKey = new PluginKey('searchReplace')

/**
 * 搜索高亮扩展 — 在编辑器中高亮所有搜索匹配项。
 * 通过 setMeta(searchPluginKey, DecorationSet) 来更新高亮状态。
 */
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, oldState) {
            const meta = tr.getMeta(searchPluginKey)
            if (meta !== undefined) {
              return meta as DecorationSet
            }
            return oldState.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return searchPluginKey.getState(state)
          },
        },
      }),
    ]
  },
})
