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
    return [{
      tag: 'crossref',
      getAttrs: (dom: HTMLElement) => {
        // 优先读取 data-* 属性（新格式），回退到旧格式（兼容历史数据）
        const featureId = dom.getAttribute('data-feature-id') || dom.getAttribute('featureid') || dom.getAttribute('featureId') || ''
        const sectionKey = dom.getAttribute('data-section-key') || dom.getAttribute('sectionkey') || dom.getAttribute('sectionKey') || ''
        const label = dom.getAttribute('data-label') || dom.getAttribute('label') || dom.textContent?.replace(/^→\s*参见：/, '')?.trim() || ''
        return { featureId, label, sectionKey }
      },
    }]
  },

  renderHTML({ HTMLAttributes }) {
    const label = (HTMLAttributes.label as string) || '...'
    // 使用 data-* 标准前缀，确保被 resolveCrossReferences 正则正确匹配
    return ['crossref', {
      'data-feature-id': HTMLAttributes.featureId,
      'data-label': HTMLAttributes.label,
      'data-section-key': HTMLAttributes.sectionKey || '',
    }, `→ 参见：${label}`]
  },
})
