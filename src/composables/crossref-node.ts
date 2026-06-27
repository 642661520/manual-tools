import { Node } from '@tiptap/core'

export interface CrossrefAttrs {
  featureId: string
  label: string
  sectionKey?: string
}

export const Crossref = Node.create({
  name: 'crossref',

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      featureId: { default: '' },
      label: { default: '' },
      sectionKey: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'crossref',
        getAttrs: (dom: HTMLElement) => {
          const featureId = dom.getAttribute('data-feature-id') || ''
          const sectionKey = dom.getAttribute('data-section-key') || ''
          const label =
            dom.getAttribute('data-label') ||
            dom.textContent?.replace(/^→\s*参见：/, '')?.trim() ||
            ''
          return { featureId, label, sectionKey }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const label = (HTMLAttributes.label as string) || '...'
    // 使用 data-* 标准前缀，确保被 resolveCrossReferences 正则正确匹配
    return [
      'crossref',
      {
        'data-feature-id': HTMLAttributes.featureId,
        'data-label': HTMLAttributes.label,
        'data-section-key': HTMLAttributes.sectionKey || '',
      },
      `→ 参见：${label}`,
    ]
  },
})
