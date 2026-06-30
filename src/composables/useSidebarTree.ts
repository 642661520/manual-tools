import { computed, type Ref } from 'vue'
import type { CatalogEntry } from '@shared/types'
import { isCatalogPart } from '@shared/types'

export interface SidebarSection {
  key: string
  title: string
  anchorId: string
}

export interface SidebarChapter {
  type: 'chapter'
  featureId: string
  title: string
  chNum: number
  sections: SidebarSection[]
  isLeaf: boolean // 仅默认小节时无展开
}

export interface SidebarPart {
  type: 'part'
  id: string
  title: string
  partIdx: number
  children: SidebarChapter[]
}

export type SidebarNode = SidebarChapter | SidebarPart

export interface FeatureMeta {
  id: string
  title: string
  description: string
  sections: Array<{ key: string; title: string; description?: string }>
}

export function useSidebarTree(catalogEntries: Ref<CatalogEntry[]>, features: Ref<FeatureMeta[]>) {
  const tree = computed<SidebarNode[]>(() => {
    const featureMap = new Map(features.value.map((f) => [f.id, f]))
    const nodes: SidebarNode[] = []
    let chNum = 1
    let partIdx = 0

    for (const entry of catalogEntries.value) {
      if (isCatalogPart(entry)) {
        partIdx++
        const children: SidebarChapter[] = []
        for (const fe of entry.features) {
          const f = featureMap.get(fe.featureId)
          if (!f) continue
          children.push(buildChapter(f, chNum))
          chNum++
        }
        if (children.length > 0) {
          nodes.push({
            type: 'part',
            id: entry.id,
            title: entry.title,
            partIdx,
            children,
          })
        }
      } else {
        const f = featureMap.get(entry.featureId)
        if (!f) continue
        nodes.push(buildChapter(f, chNum))
        chNum++
      }
    }

    return nodes
  })

  const chapterMap = computed(() => {
    const map = new Map<string, number>()
    let chNum = 1
    for (const entry of catalogEntries.value) {
      if (isCatalogPart(entry)) {
        for (const fe of entry.features) {
          map.set(fe.featureId, chNum++)
        }
      } else {
        map.set(entry.featureId, chNum++)
      }
    }
    return map
  })

  const hasParts = computed(() => catalogEntries.value.some((e) => isCatalogPart(e)))

  // 使用树中实际可见的章节数（已跳过删除的 feature）
  const totalChapters = computed(() => {
    let count = 0
    for (const node of tree.value) {
      if (node.type === 'part') {
        count += node.children.length
      } else {
        count++
      }
    }
    return count
  })

  return { tree, chapterMap, hasParts, totalChapters }
}

function buildChapter(f: FeatureMeta, chNum: number): SidebarChapter {
  const isLeaf = f.sections.length === 1 && f.sections[0].key === '_default'
  return {
    type: 'chapter',
    featureId: f.id,
    title: f.title,
    chNum,
    isLeaf,
    sections: f.sections.map((s, i) => ({
      key: s.key,
      title: s.title,
      anchorId: `ch${chNum}-s${i + 1}`,
    })),
  }
}
