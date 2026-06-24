import { Node, mergeAttributes } from '@tiptap/core'

export interface VideoAttrs {
  src: string
  width?: number | null  // 百分比
}

export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'video' }]
  },

  renderHTML({ HTMLAttributes }) {
    const { width, ...rest } = HTMLAttributes as Record<string, unknown>
    const style = width != null ? `width: ${width}%; display: block; margin: 0 auto;` : ''
    return ['video', mergeAttributes(rest, {
      controls: 'true',
      preload: 'metadata',
      style: style || undefined,
      class: 'max-w-full rounded-lg',
    })]
  },
})
