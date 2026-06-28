<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import Sortable from 'sortablejs'
import { useProject } from '@/composables/useProject'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import { useResponsiveSidebar } from '@/composables/useResponsiveSidebar'
import { getFeatures } from '@/api/endpoints/features'
import {
  getCatalog,
  updateCatalog,
  deleteCatalog as apiDeleteCatalog,
} from '@/api/endpoints/catalogs'
import { getCategories } from '@/api/endpoints/categories'
import type { FeatureSummary, CategoryInfo, CatalogEntry } from '@shared/types'
import { parseSections } from '@shared/utils/sections'

// 本地类型：手册中引用的内容
interface CatFeature {
  id: string
  title: string
  description: string
  sections: string // JSON string
  categoryId: string | null
  totalSections?: number
  approvedSections?: number
}

interface CatEntry {
  feature: CatFeature
  sectionOrder?: string[]
}

interface CatPart {
  type: 'part'
  id: string
  title: string
  features: CatEntry[]
}

type CatNode = CatEntry | CatPart

function isPart(node: CatNode): node is CatPart {
  return (node as CatPart).type === 'part'
}

interface CatalogResponseFeature {
  id: string
  title: string
  description: string
  sections: Array<{ key: string; title: string }>
  categoryId: string | null
  sectionOrder?: string[]
}

interface CatalogResponsePart {
  type: 'part'
  id: string
  title: string
  features: CatalogResponseFeature[]
}

type CatalogResponseNode = CatalogResponseFeature | CatalogResponsePart

interface CatalogResponse {
  title: string
  targets: string[]
  features: CatalogResponseNode[]
}

interface SortableElement extends HTMLElement {
  _sortable?: Sortable
}
import PageHeader from '@/components/PageHeader.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import EmptyState from '@/components/EmptyState.vue'
import CreateEditManualModal from '@/components/CreateEditManualModal.vue'

const route = useRoute()
const router = useRouter()
const { currentProjectId } = useProject()
const { canManageProject } = useAuth()
const { confirm, dangerConfirm } = useDialog()
const catalogId = computed(() => route.params.id as string)

const catalog = ref<{ title: string; targets: string[]; entries: CatNode[] }>({
  title: '',
  targets: [] as string[],
  entries: [] as CatNode[],
})

const allFeatures = ref<FeatureSummary[]>([])
const categories = ref<CategoryInfo[]>([])
const searchQuery = ref('')
const saving = ref(false)
const saveError = ref('')
const expandedIndex = ref<number | null>(null)
const highlightedId = ref<string | null>(null)
const dirty = ref(false)
const loading = ref(false)
const saveSuccess = ref(false)
const showEditInfoModal = ref(false)
const {
  sidebarOpen: showPool,
  toggleSidebar: togglePool,
  closeSidebar: closePool,
} = useResponsiveSidebar()
const movingFeatureId = ref<string | null>(null)
const movingPoolFeature = ref<FeatureSummary | null>(null)
const moveMenuX = ref(0)
const moveMenuY = ref(0)
const poolMenuX = ref(0)
const poolMenuY = ref(0)

function openMoveMenu(e: MouseEvent, featureId: string) {
  if (movingFeatureId.value === featureId) {
    movingFeatureId.value = null
    return
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  moveMenuX.value = rect.left
  moveMenuY.value = rect.bottom + 4
  movingFeatureId.value = featureId
}

function openPoolMoveMenu(e: MouseEvent, f: FeatureSummary) {
  if (movingPoolFeature.value?.id === f.id) {
    movingPoolFeature.value = null
    return
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  poolMenuX.value = rect.right
  poolMenuY.value = rect.top
  movingPoolFeature.value = f
}

// 解析 sections JSON 用于展示
function getSections(f: { sections?: string }): { key: string; title: string }[] {
  return parseSections(f.sections || '[]')
}

// 获取当前排序后的 sections（按 sectionOrder）
function getOrderedSections(entry: CatEntry): { key: string; title: string }[] {
  const raw = getSections(entry.feature)
  if (entry.sectionOrder) {
    return entry.sectionOrder
      .map((k: string) => raw.find((s) => s.key === k))
      .filter(Boolean) as typeof raw
  }
  return raw
}

// 获取被移除的小节（sections 中存在但 sectionOrder 中不存在的）
function getRemovedSections(entry: CatEntry): { key: string; title: string }[] {
  const all = getSections(entry.feature)
  if (!entry.sectionOrder) return []
  const inOrder = new Set(entry.sectionOrder)
  return all.filter((s) => !inOrder.has(s.key))
}

const categoryInfo = computed(() => {
  const map = new Map<string, { name: string; color: string }>()
  for (const c of categories.value) {
    map.set(c.id, { name: c.name, color: c.color })
  }
  return map
})

const categoryMap = computed(() => new Map(categories.value.map((c) => [c.id, c.name])))

// 收集所有已选中的 feature id
const selectedFeatureIds = computed(() => {
  const ids = new Set<string>()
  for (const node of catalog.value.entries) {
    if (isPart(node)) {
      for (const fe of node.features) ids.add(fe.feature.id)
    } else {
      ids.add(node.feature.id)
    }
  }
  return ids
})

// 过滤可选内容
const filteredFeatures = computed(() => {
  const q = searchQuery.value.toLowerCase()
  return allFeatures.value.filter((f: FeatureSummary) => {
    const catName = f.categoryId ? categoryMap.value.get(f.categoryId) || '' : ''
    return (
      !selectedFeatureIds.value.has(f.id) &&
      (!q || f.title.toLowerCase().includes(q) || catName.toLowerCase().includes(q))
    )
  })
})

// 按分类分组
const grouped = computed(() => {
  const groups: Record<string, FeatureSummary[]> = {}

  for (const f of filteredFeatures.value) {
    const catId = f.categoryId || '__uncategorized__'
    if (!groups[catId]) groups[catId] = []
    groups[catId].push(f)
  }

  // 保持分类顺序，未分类放最后
  const sorted: Record<string, FeatureSummary[]> = {}
  const catOrder = [...categories.value].sort(
    (a: CategoryInfo, b: CategoryInfo) => a.sortOrder - b.sortOrder,
  )
  for (const c of catOrder) {
    if (groups[c.id]) sorted[c.id] = groups[c.id]
  }
  if (groups['__uncategorized__']) sorted['__uncategorized__'] = groups['__uncategorized__']
  return sorted
})

async function loadData() {
  loading.value = true
  const catalogIdVal = catalogId.value
  const pid = currentProjectId.value

  const [featuresRes, categoriesRes] = await Promise.all([
    getFeatures(pid || undefined),
    getCategories(pid || undefined),
  ])
  allFeatures.value = featuresRes
  categories.value = categoriesRes

  try {
    const data = (await getCatalog(catalogIdVal)) as unknown as CatalogResponse
    function parseNode(node: CatalogResponseNode): CatNode {
      if ((node as CatalogResponsePart).type === 'part') {
        const p = node as CatalogResponsePart
        return {
          type: 'part',
          id: p.id,
          title: p.title,
          features: (p.features || []).map((f: CatalogResponseFeature) => ({
            feature: {
              id: f.id,
              title: f.title,
              description: f.description,
              sections: JSON.stringify(f.sections || []),
              categoryId: f.categoryId,
            },
            sectionOrder: f.sectionOrder,
          })),
        }
      }
      const f = node as CatalogResponseFeature
      return {
        feature: {
          id: f.id,
          title: f.title,
          description: f.description,
          sections: JSON.stringify(f.sections || []),
          categoryId: f.categoryId,
        },
        sectionOrder: f.sectionOrder,
      }
    }
    catalog.value = {
      title: data.title,
      targets: data.targets || [],
      entries: (data.features || []).map(parseNode),
    }
  } catch {
    // 无权访问或不存在，清空内容
    catalog.value = { title: '', targets: [], entries: [] }
  }
  dirty.value = false
  await nextTick()
  loading.value = false
}

function addFeature(f: FeatureSummary) {
  const sectionsStr = typeof f.sections === 'string' ? f.sections : JSON.stringify(f.sections || [])
  catalog.value.entries.push({
    feature: {
      id: f.id,
      title: f.title,
      description: f.description,
      sections: sectionsStr,
      categoryId: f.categoryId,
      totalSections: f.totalSections,
      approvedSections: f.approvedSections,
    },
  })
  dirty.value = true
  highlightedId.value = f.id
  nextTick(() => {
    const el = sortList.value?.querySelector(`[data-entry-id="${f.id}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setTimeout(() => {
      highlightedId.value = null
    }, 1500)
  })
}

// 添加 Part
function addPart() {
  const partCount = catalog.value.entries.filter((e) => isPart(e)).length + 1
  catalog.value.entries.push({
    type: 'part',
    id: `part-${Date.now()}`,
    title: `篇 ${partCount}`,
    features: [],
  })
  dirty.value = true
}

// 删除 Part（features 提升到顶层）
function removePart(index: number) {
  const node = catalog.value.entries[index]
  if (!isPart(node)) return
  // 将 part 内的 features 提升到 entries 顶层
  const promoted = node.features
  catalog.value.entries.splice(index, 1, ...promoted)
  dirty.value = true
}

// 向 Part 内添加 feature
function addFeatureToPart(targetPartId: string, f: FeatureSummary) {
  const node = catalog.value.entries.find((e) => isPart(e) && (e as CatPart).id === targetPartId)
  if (!node || !isPart(node)) return
  const sectionsStr = typeof f.sections === 'string' ? f.sections : JSON.stringify(f.sections || [])
  node.features.push({
    feature: {
      id: f.id,
      title: f.title,
      description: f.description,
      sections: sectionsStr,
      categoryId: f.categoryId,
      totalSections: f.totalSections,
      approvedSections: f.approvedSections,
    },
  })
  dirty.value = true
  highlightedId.value = f.id
  nextTick(() => {
    const el = sortList.value?.querySelector(`[data-entry-id="${f.id}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setTimeout(() => {
      highlightedId.value = null
    }, 1500)
  })
}

// 从 Part 中移除 feature（提升到顶层）
function removeFeatureFromPart(partIndex: number, featIndex: number) {
  const node = catalog.value.entries[partIndex]
  if (!isPart(node)) return
  const [removed] = node.features.splice(featIndex, 1)
  if (removed) {
    // 插入到该 part 之后
    catalog.value.entries.splice(partIndex + 1, 0, removed)
  }
  dirty.value = true
}

function removeFeature(entryIndex: number) {
  catalog.value.entries.splice(entryIndex, 1)
  if (expandedIndex.value === entryIndex) expandedIndex.value = null
  else if (expandedIndex.value !== null && expandedIndex.value > entryIndex) expandedIndex.value--
  dirty.value = true
}

async function deleteCatalog(id: string) {
  if (!(await dangerConfirm('确定删除此手册？\n导出版本历史也将被删除，不可恢复。'))) return
  await apiDeleteCatalog(id)
  // 删除后返回列表页
  router.push('/manuals')
}

function toggleExpand(index: number) {
  expandedIndex.value = expandedIndex.value === index ? null : index
  nextTick(() => initSectionSorts())
}

// section 拖拽排序（entryIndex 指向 entries 中的 CatEntry）
function updateSectionOrder(entryIndex: number, newOrder: string[]) {
  const entry = catalog.value.entries[entryIndex]
  if (isPart(entry)) return
  const defaultOrder = getSections(entry.feature).map((s) => s.key)
  // 只有顺序跟默认不同时才保存
  const isSame =
    newOrder.length === defaultOrder.length && newOrder.every((k, i) => k === defaultOrder[i])
  entry.sectionOrder = isSame ? undefined : newOrder
  if (!isSame) dirty.value = true
}

// Part 内 section 排序（partIndex + featIndex）
function updateSectionOrderInPart(partIndex: number, featIndex: number, newOrder: string[]) {
  const node = catalog.value.entries[partIndex]
  if (!isPart(node)) return
  const entry = node.features[featIndex]
  const defaultOrder = getSections(entry.feature).map((s) => s.key)
  const isSame =
    newOrder.length === defaultOrder.length && newOrder.every((k, i) => k === defaultOrder[i])
  entry.sectionOrder = isSame ? undefined : newOrder
  if (!isSame) dirty.value = true
}

// 从编排中移除某个小节
async function removeSection(entryIndex: number, sectionKey: string) {
  const entry = catalog.value.entries[entryIndex]
  if (isPart(entry)) return
  const current = getOrderedSections(entry).map((s) => s.key)
  if (
    current.length <= 1 &&
    !(await confirm('这是最后一个小节，确定移除？\n移除后该章在手册中将没有可见内容。'))
  )
    return
  const filtered = current.filter((k) => k !== sectionKey)
  updateSectionOrder(entryIndex, filtered)
  dirty.value = true
}

// 恢复被移除的小节（添加到 sectionOrder 末尾）
function restoreSection(entryIndex: number, sectionKey: string) {
  const entry = catalog.value.entries[entryIndex]
  if (isPart(entry)) return
  const current = entry.sectionOrder || getSections(entry.feature).map((s) => s.key)
  entry.sectionOrder = [...current, sectionKey]
  dirty.value = true
}

// Part 内移除小节
async function removeSectionInPart(partIndex: number, featIndex: number, sectionKey: string) {
  const node = catalog.value.entries[partIndex]
  if (!isPart(node)) return
  const entry = node.features[featIndex]
  const current = getOrderedSections(entry).map((s) => s.key)
  if (
    current.length <= 1 &&
    !(await confirm('这是最后一个小节，确定移除？\n移除后该章在手册中将没有可见内容。'))
  )
    return
  const filtered = current.filter((k) => k !== sectionKey)
  updateSectionOrderInPart(partIndex, featIndex, filtered)
  dirty.value = true
}

// Part 内恢复小���
function restoreSectionInPart(partIndex: number, featIndex: number, sectionKey: string) {
  const node = catalog.value.entries[partIndex]
  if (!isPart(node)) return
  const entry = node.features[featIndex]
  const current = entry.sectionOrder || getSections(entry.feature).map((s) => s.key)
  entry.sectionOrder = [...current, sectionKey]
  dirty.value = true
}

async function save() {
  saveError.value = ''
  if (!catalog.value.title.trim()) {
    saveError.value = '请输入手册名称'
    saving.value = true
    saving.value = false
    return
  }
  saving.value = true
  try {
    function serializeNode(node: CatNode): object {
      if (isPart(node)) {
        return {
          type: 'part',
          id: node.id,
          title: node.title,
          features: node.features.map((e: CatEntry) => ({
            featureId: e.feature.id,
            sectionOrder: e.sectionOrder,
          })),
        }
      }
      return {
        featureId: node.feature.id,
        sectionOrder: node.sectionOrder,
      }
    }
    const payload = {
      title: catalog.value.title.trim(),
      targets: catalog.value.targets,
      features: catalog.value.entries.map(serializeNode) as CatalogEntry[],
      cover: {},
      projectId: currentProjectId.value || undefined,
    }

    await updateCatalog(catalogId.value, payload)
    dirty.value = false
    saveSuccess.value = true
    setTimeout(() => {
      saveSuccess.value = false
    }, 2000)
    await loadData()
    await nextTick()
    initAllSorts()
  } catch (e: unknown) {
    saveError.value = e instanceof Error ? e.message : '网络错误，保存失败'
  } finally {
    saving.value = false
  }
}

// 路由参数变化时重新加载（如 /new → /abc123 保存后）
watch(catalogId, () => {
  loadData().then(() => {
    nextTick(() => {
      initAllSorts()
    })
  })
})

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault()
  }
}

onBeforeRouteLeave(async () => {
  if (dirty.value && !(await confirm('有未保存的更改，确定离开？'))) return false
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

// 计算全局 feature 编号（跨 Part 连续）
function getGlobalFeatNum(entryIndex: number, featIndex?: number): number {
  let count = 0
  for (let i = 0; i < catalog.value.entries.length; i++) {
    const node = catalog.value.entries[i]
    if (i === entryIndex) {
      if (isPart(node)) {
        // 对于 part 内的 feature，计算在它之前的 feature 数量
        if (featIndex !== undefined) {
          return count + featIndex + 1
        }
        // 对于 part 本身，返回其第一个 feature 的编号
        return count + 1
      }
      return count + 1
    }
    if (isPart(node)) {
      count += node.features.length
    } else {
      count++
    }
  }
  return count + 1
}

// ====== 拖拽系统 ======
// SortableJS 负责同容器内排序；左侧池 HTML5 拖拽负责添加到右侧
const sortList = ref<HTMLElement>()

// ---- 左侧池 HTML5 拖拽 → 右侧 ----

function onPoolDragStart(e: DragEvent, f: FeatureSummary) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('text/plain', f.id)
  e.dataTransfer.effectAllowed = 'copy'
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

/** 主区域 drop：接收左侧池拖入 → 顶层 */
function onDrop(e: DragEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.part-drop-target')) return
  const featureId = e.dataTransfer?.getData('text/plain')
  if (!featureId) return
  const f = allFeatures.value.find((x: FeatureSummary) => x.id === featureId)
  if (f) addFeature(f)
}

// ---- Part 容器 HTML5 drop：接收左侧池拖入 ----

function onPartDragEnter(e: DragEvent) {
  const el = (e.currentTarget as HTMLElement).closest('.part-drop-target') as HTMLElement | null
  if (!el) return
  const count = Number(el.dataset.dragCount || '0') + 1
  el.dataset.dragCount = String(count)
  el.classList.add('bg-indigo-50')
}

function onPartDragLeave(e: DragEvent) {
  const el = (e.currentTarget as HTMLElement).closest('.part-drop-target') as HTMLElement | null
  if (!el) return
  const count = Math.max(0, Number(el.dataset.dragCount || '1') - 1)
  el.dataset.dragCount = String(count)
  if (count === 0) el.classList.remove('bg-indigo-50')
}

function onPartDrop(e: DragEvent) {
  const el = (e.currentTarget as HTMLElement).closest('.part-drop-target') as HTMLElement | null
  if (el) {
    el.dataset.dragCount = '0'
    el.classList.remove('bg-indigo-50')
  }
  const targetPartId = el?.dataset.partId
  if (!targetPartId) return
  const featureId = e.dataTransfer?.getData('text/plain')
  if (!featureId) return
  const f = allFeatures.value.find((x: FeatureSummary) => x.id === featureId)
  if (!f) return
  const node = catalog.value.entries.find((e) => isPart(e) && (e as CatPart).id === targetPartId)
  if (!node || !isPart(node)) return
  const sectionsStr = typeof f.sections === 'string' ? f.sections : JSON.stringify(f.sections || [])
  node.features.push({
    feature: {
      id: f.id,
      title: f.title,
      description: f.description,
      sections: sectionsStr,
      categoryId: f.categoryId,
      totalSections: f.totalSections,
      approvedSections: f.approvedSections,
    },
  })
  dirty.value = true
  nextTick(() => initAllSorts())
}

// ---- 按钮操作：跨容器移动 ----

function moveFeatureToPart(featureId: string, targetPartId: string) {
  const src = findEntryById(featureId)
  if (!src || src.type === 'part') return // 只在顶层才能移入 Part
  const n = catalog.value.entries[src.entryIndex]
  if (!n || isPart(n)) return
  const [moved] = catalog.value.entries.splice(src.entryIndex, 1) as unknown as CatEntry[]
  const targetNode = catalog.value.entries.find(
    (e) => isPart(e) && (e as CatPart).id === targetPartId,
  )
  if (!targetNode || !isPart(targetNode)) {
    catalog.value.entries.push(moved)
  } else {
    targetNode.features.push(moved)
  }
  expandedIndex.value = null
  dirty.value = true
  nextTick(() => initAllSorts())
}

function handleMoveToPart(featureId: string, targetPartId: string) {
  moveFeatureToPart(featureId, targetPartId)
  movingFeatureId.value = null
}

function handleAddToPart(targetPartId: string, feature: FeatureSummary | null) {
  if (!feature) return
  addFeatureToPart(targetPartId, feature)
  movingPoolFeature.value = null
}

function getPartId(en: CatNode): string {
  return isPart(en) ? en.id : ''
}

/** 在数据模型中查找 featureId */
function findEntryById(
  featureId: string,
): { type: 'main' | 'part'; entryIndex: number; featIndex?: number } | null {
  for (let i = 0; i < catalog.value.entries.length; i++) {
    const node = catalog.value.entries[i]
    if (isPart(node)) {
      for (let j = 0; j < node.features.length; j++) {
        if (node.features[j].feature.id === featureId)
          return { type: 'part', entryIndex: i, featIndex: j }
      }
    } else if (node.feature.id === featureId) return { type: 'main', entryIndex: i }
  }
  return null
}

// ---- SortableJS：同容器内排序 ----

function initSort() {
  if (!sortList.value) return
  const el = sortList.value as SortableElement
  if (el._sortable) el._sortable.destroy()
  Sortable.create(sortList.value, {
    animation: 200,
    handle: '.drag-handle',
    filter: '.drop-zone-placeholder',
    ghostClass: 'bg-blue-50',
    onEnd(evt) {
      if (evt.oldIndex === undefined || evt.newIndex === undefined) return
      const [moved] = catalog.value.entries.splice(evt.oldIndex, 1)
      catalog.value.entries.splice(evt.newIndex, 0, moved)
      expandedIndex.value = null
      dirty.value = true
    },
  })
}

function initPartSorts() {
  const containers = sortList.value?.querySelectorAll<HTMLElement>('.part-features-sort')
  containers?.forEach((container) => {
    const el = container as SortableElement
    if (el._sortable) el._sortable.destroy()
    const partId = (container.closest('.part-drop-target') as HTMLElement | null)?.dataset.partId
    if (!partId) return
    Sortable.create(container, {
      animation: 200,
      handle: '.part-feat-drag',
      ghostClass: 'bg-blue-50',
      onEnd(evt) {
        if (evt.oldIndex === undefined || evt.newIndex === undefined) return
        const node = catalog.value.entries.find((e) => isPart(e) && (e as CatPart).id === partId)
        if (!node || !isPart(node)) return
        const [moved] = node.features.splice(evt.oldIndex, 1)
        node.features.splice(evt.newIndex, 0, moved)
        dirty.value = true
      },
    })
  })
}

function initAllSorts() {
  initSort()
  initPartSorts()
  initSectionSorts()
}

// ---- 小节排序 ----

function initSectionSorts() {
  const areas = sortList.value?.querySelectorAll<HTMLElement>('.section-sort-area')
  areas?.forEach((area) => {
    const el = area as SortableElement
    if (el._sortable) el._sortable.destroy()
    const featureId = area.dataset.featureId
    if (!featureId) return
    Sortable.create(area, {
      animation: 200,
      handle: '.section-drag-handle',
      ghostClass: 'bg-blue-50',
      onEnd(evt) {
        if (evt.oldIndex === undefined || evt.newIndex === undefined) return
        // 用 featureId 查找 entry（避免索引移位）
        const src = findEntryById(featureId)
        if (!src) return
        let entry: CatEntry | undefined
        if (src.type === 'part' && src.featIndex !== undefined) {
          const node = catalog.value.entries[src.entryIndex]
          if (isPart(node)) entry = node.features[src.featIndex]
        } else if (src.type === 'main') {
          const node = catalog.value.entries[src.entryIndex]
          if (!isPart(node)) entry = node
        }
        if (!entry) return
        const ordered = getOrderedSections(entry)
        const [moved] = ordered.splice(evt.oldIndex, 1)
        ordered.splice(evt.newIndex, 0, moved)
        const defaultOrder = getSections(entry.feature).map((s) => s.key)
        const newOrder = ordered.map((s) => s.key)
        const isSame =
          newOrder.length === defaultOrder.length && newOrder.every((k, i) => k === defaultOrder[i])
        entry.sectionOrder = isSame ? undefined : newOrder
        dirty.value = true
      },
    })
  })
}

onMounted(async () => {
  await loadData()
  await nextTick()
  initAllSorts()
})

// 手册内容变化时重建拖拽
watch(
  () => catalog.value.entries.length,
  async () => {
    await nextTick()
    initAllSorts()
  },
)

watch(currentProjectId, () => {
  loadData().then(() => {
    nextTick(() => {
      initAllSorts()
    })
  })
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 头部 -->
    <PageHeader>
      <template #left>
        <button
          class="text-sm text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1 flex-shrink-0"
          @click="router.push('/manuals')"
        >
          <span class="i-lucide-arrow-left w-4 h-4 inline-block align-middle" />
          返回手册列表
        </button>
        <div class="w-px h-5 bg-gray-200" />
        <span class="text-base font-semibold text-gray-800">{{
          catalog.title || '未命名手册'
        }}</span>
        <button
          v-if="canManageProject"
          class="text-gray-300 hover:text-blue-500 transition-colors flex-shrink-0"
          v-tooltip="'编辑手册信息'"
          @click="showEditInfoModal = true"
        >
          <span class="i-lucide-pencil w-4 h-4 inline-block align-middle" />
        </button>
      </template>
      <template #right>
        <span class="inline-flex items-center gap-1 flex-shrink-0 min-w-[56px]">
          <span v-if="dirty" class="text-xs text-amber-500 flex items-center gap-1"
            ><span class="w-1.5 h-1.5 rounded-full bg-amber-400" />未保存</span
          >
          <span v-if="saveSuccess" class="text-xs text-green-600 flex items-center gap-1"
            ><span class="i-lucide-check w-3.5 h-3.5 inline-block align-middle" />已保存</span
          >
        </span>
        <ErrorMessage :message="saveError" />
        <span :class="{ invisible: !canManageProject }" class="inline-flex items-center gap-2">
          <button
            class="btn-secondary text-sm text-red-400 hover:text-red-600"
            @click="deleteCatalog(catalogId)"
          >
            <span class="i-lucide-trash-2 w-4 h-4 inline-block align-middle" />
          </button>
          <button class="btn-primary text-sm" :disabled="saving" @click="save">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </span>
      </template>
    </PageHeader>

    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧：可选内容（仅 PM 可编辑） -->
      <aside
        v-if="canManageProject"
        class="w-72 border-r border-gray-200 bg-white flex-shrink-0 flex-col hidden md:flex"
      >
        <div class="p-4 flex-shrink-0">
          <input v-model="searchQuery" class="input text-sm" placeholder="搜索内容..." />
        </div>

        <div class="flex-1 overflow-y-auto px-4 pb-3">
          <template v-for="(items, catId) in grouped" :key="catId">
            <div
              class="text-xs font-semibold text-gray-400 uppercase mb-2 mt-3 flex items-center gap-1.5 left-pool-header"
            >
              <span
                v-if="catId !== '__uncategorized__' && categoryInfo.has(catId)"
                class="w-2 h-2 rounded-full flex-shrink-0"
                :style="{ backgroundColor: categoryInfo.get(catId)!.color }"
              />
              <span v-if="catId === '__uncategorized__'" class="text-gray-300">未分类</span>
              <span v-else>{{ categoryInfo.get(catId)?.name || catId }}</span>
            </div>
            <div
              v-for="f in items"
              :key="f.id"
              :data-feature-id="f.id"
              class="w-full text-left rounded-lg text-sm hover:bg-gray-50 transition-colors mb-1 flex items-center group"
            >
              <button
                class="flex-1 flex items-center gap-2 px-3 py-2 cursor-grab"
                draggable="true"
                @click="addFeature(f)"
                @dragstart="onPoolDragStart($event, f)"
              >
                <span class="flex-1 text-gray-700 text-left">{{ f.title }}</span>
                <span v-if="f.totalSections" class="text-xs text-gray-400 flex-shrink-0">
                  {{ f.approvedSections ?? 0 }}/{{ f.totalSections }}
                </span>
              </button>
              <div v-if="catalog.entries.some((e) => isPart(e))" class="relative flex-shrink-0">
                <button
                  class="text-gray-300 hover:text-indigo-500 px-1 py-2 transition-colors"
                  v-tooltip="'添加到篇'"
                  @click.stop="openPoolMoveMenu($event, f)"
                >
                  <span class="i-lucide-book-plus w-3.5 h-3.5 inline-block align-middle" />
                </button>
              </div>
            </div>
          </template>

          <EmptyState v-if="Object.keys(grouped).length === 0" title="暂无可用内容" />
        </div>
      </aside>

      <!-- 移动端内容池抽屉 -->
      <Teleport to="body">
        <Transition name="slide-left">
          <div v-if="showPool && canManageProject" class="fixed inset-0 z-40 md:hidden">
            <div class="absolute inset-0 bg-black/30" @click="closePool" />
            <aside
              class="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col"
            >
              <div
                class="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0"
              >
                <span class="text-sm font-semibold text-gray-700">内容池</span>
                <button
                  class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
                  @click="closePool"
                >
                  <span class="i-lucide-x w-5 h-5 text-gray-500" />
                </button>
              </div>
              <div class="p-4 flex-shrink-0">
                <input
                  v-model="searchQuery"
                  class="input text-sm"
                  placeholder="搜索内容..."
                  @input="closePool()"
                />
              </div>
              <div class="flex-1 overflow-y-auto px-4 pb-3">
                <template v-for="(items, catId) in grouped" :key="catId">
                  <div
                    class="text-xs font-semibold text-gray-400 uppercase mb-2 mt-3 flex items-center gap-1.5"
                  >
                    <span
                      v-if="catId !== '__uncategorized__' && categoryInfo.has(catId)"
                      class="w-2 h-2 rounded-full flex-shrink-0"
                      :style="{ backgroundColor: categoryInfo.get(catId)!.color }"
                    />
                    <span v-if="catId === '__uncategorized__'" class="text-gray-300">未分类</span>
                    <span v-else>{{ categoryInfo.get(catId)?.name || catId }}</span>
                  </div>
                  <div
                    v-for="f in items"
                    :key="f.id"
                    class="w-full text-left rounded-lg text-sm hover:bg-gray-50 transition-colors mb-1 flex items-center group"
                  >
                    <button
                      class="flex-1 flex items-center gap-2 px-3 py-2"
                      @click="
                        addFeature(f)
                        closePool()
                      "
                    >
                      <span class="flex-1 text-gray-700 text-left">{{ f.title }}</span>
                      <span v-if="f.totalSections" class="text-xs text-gray-400 flex-shrink-0">
                        {{ f.approvedSections ?? 0 }}/{{ f.totalSections }}
                      </span>
                    </button>
                  </div>
                </template>
                <EmptyState v-if="Object.keys(grouped).length === 0" title="暂无可用内容" />
              </div>
            </aside>
          </div>
        </Transition>
      </Teleport>

      <!-- 右侧：已编排内容 -->
      <main
        class="flex-1 overflow-y-auto bg-gray-50 p-3 sm:p-6"
        @dragover="onDragOver"
        @drop="onDrop"
      >
        <!-- 移动端内容池按钮 -->
        <div v-if="canManageProject" class="mb-3 max-w-3xl flex items-center gap-2">
          <button
            class="md:hidden btn-secondary text-sm flex items-center gap-1"
            @click="togglePool"
          >
            <span class="i-lucide-library w-4 h-4 inline-block align-middle" />内容池
          </button>
          <button class="btn-secondary text-sm" @click="addPart">
            <span class="i-lucide-book-plus w-4 h-4 inline-block align-middle" /> 添加篇
          </button>
        </div>

        <div ref="sortList" class="space-y-3 max-w-3xl min-h-[240px] pb-24">
          <!-- 空状态 / 拖放目标区 -->
          <div
            v-if="catalog.entries.length === 0"
            class="drop-zone-placeholder border-2 border-dashed border-gray-300 rounded-xl h-48 flex flex-col items-center justify-center text-gray-400 transition-colors hover:border-blue-400 hover:text-blue-400"
          >
            <span class="i-lucide-book-open text-3xl mb-3 opacity-40" />
            <span class="text-sm">从左侧拖入或点击内容添加到手册</span>
          </div>

          <template
            v-for="(node, ni) in catalog.entries"
            :key="isPart(node) ? node.id : node.feature.id"
          >
            <!-- ====== Part 容器 ====== -->
            <div
              v-if="isPart(node)"
              class="part-drop-target card !p-0 overflow-hidden border-l-4 border-indigo-300 transition-colors"
              :data-part-index="ni"
              :data-part-id="node.id"
              @dragenter.prevent="onPartDragEnter($event)"
              @dragleave="onPartDragLeave($event)"
              @dragover.prevent
              @drop.stop.prevent="onPartDrop($event)"
            >
              <div class="flex items-center gap-3 px-4 py-3 bg-indigo-50/50">
                <div
                  v-if="canManageProject"
                  class="drag-handle cursor-grab text-gray-300 hover:text-gray-500"
                >
                  <span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" />
                </div>
                <span
                  class="i-lucide-book-open text-indigo-400 w-4 h-4 inline-block align-middle flex-shrink-0"
                />
                <input
                  v-model="node.title"
                  class="flex-1 text-sm font-semibold bg-transparent border-none outline-none text-gray-800"
                  placeholder="篇名称"
                  @input="dirty = true"
                />
                <span class="text-xs text-gray-400 flex-shrink-0"
                  >{{ node.features.length }} 章</span
                >
                <button
                  v-if="canManageProject"
                  class="text-red-400 hover:text-red-600 text-sm flex-shrink-0"
                  v-tooltip="'删除此篇（内容将提升到顶层）'"
                  @click="removePart(ni)"
                >
                  <span class="i-lucide-trash-2 w-4 h-4 inline-block align-middle" />
                </button>
              </div>

              <!-- Part 内的 features（始终渲染以支持 SortableJS group 空容器拖入） -->
              <div
                class="part-features-sort border-t border-gray-100"
                :class="{ 'min-h-[40px]': node.features.length === 0 }"
              >
                <div
                  v-if="node.features.length === 0"
                  class="px-4 py-3 text-xs text-gray-400 text-center"
                >
                  拖入左侧内容，或点击左侧内容的
                  <span
                    class="i-lucide-book-plus w-3 h-3 inline-block align-middle text-indigo-400"
                  />
                  按钮添加到此处
                </div>
                <div
                  v-for="(fe, fi) in node.features"
                  :key="fe.feature.id"
                  :data-entry-id="fe.feature.id"
                  class="border-b border-gray-50 last:border-b-0"
                  :class="{ 'highlight-new': highlightedId === fe.feature.id }"
                >
                  <div
                    class="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50"
                    @click="toggleExpand(ni * 10000 + fi)"
                  >
                    <div
                      v-if="canManageProject"
                      class="part-feat-drag cursor-grab text-gray-300 hover:text-gray-500 flex-shrink-0"
                    >
                      <span class="i-lucide-grip-vertical w-3.5 h-3.5 inline-block align-middle" />
                    </div>
                    <span
                      class="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded"
                      >{{ getGlobalFeatNum(ni, fi) }}</span
                    >
                    <span
                      :class="
                        expandedIndex === ni * 10000 + fi
                          ? 'i-lucide-chevron-down'
                          : 'i-lucide-chevron-right'
                      "
                      class="w-3.5 h-3.5 text-gray-400 inline-block align-middle flex-shrink-0"
                    />
                    <div class="flex-1 min-w-0">
                      <span class="text-sm text-gray-800">{{ fe.feature.title }}</span>
                      <span
                        v-if="fe.feature.totalSections"
                        class="text-xs ml-1.5"
                        :class="
                          (fe.feature.approvedSections ?? 0) === (fe.feature.totalSections ?? 0)
                            ? 'text-green-500'
                            : 'text-gray-400'
                        "
                      >
                        ✓{{ fe.feature.approvedSections ?? 0 }}/{{ fe.feature.totalSections }}
                      </span>
                    </div>
                    <button
                      v-if="canManageProject"
                      class="text-gray-300 hover:text-red-500 text-xs"
                      v-tooltip="'移出此篇'"
                      @click.stop="removeFeatureFromPart(ni, fi)"
                    >
                      <span class="i-lucide-log-out w-3.5 h-3.5 inline-block align-middle" />
                    </button>
                  </div>

                  <!-- 展开的 section 排序 -->
                  <div
                    v-if="expandedIndex === ni * 10000 + fi"
                    class="border-t border-gray-100 bg-gray-50 px-4 py-2"
                  >
                    <div v-if="canManageProject" class="text-xs text-gray-400 mb-2">
                      小节排序（拖拽调整，点击 × 移除）
                    </div>
                    <div class="section-sort-area space-y-1" :data-feature-id="fe.feature.id">
                      <div
                        v-for="(sec, si) in getOrderedSections(fe)"
                        :key="sec.key"
                        class="flex items-center gap-2 text-sm bg-white px-3 py-1.5 rounded border border-gray-100 group"
                      >
                        <div
                          v-if="canManageProject"
                          class="section-drag-handle cursor-grab text-gray-300 hover:text-gray-500"
                        >
                          <span
                            class="i-lucide-grip-vertical w-3.5 h-3.5 inline-block align-middle"
                          />
                        </div>
                        <span class="text-gray-400 font-mono text-xs"
                          >{{ getGlobalFeatNum(ni, fi) }}.{{ si + 1 }}</span
                        >
                        <span class="text-gray-700 flex-1">{{ sec.title }}</span>
                        <button
                          v-if="canManageProject"
                          class="text-red-400 hover:text-red-600"
                          v-tooltip="'移除此小节'"
                          @click.stop="removeSectionInPart(ni, fi, sec.key)"
                        >
                          <span class="i-lucide-x w-3.5 h-3.5 inline-block align-middle" />
                        </button>
                      </div>
                    </div>
                    <!-- 已移除的小节 -->
                    <div v-if="getRemovedSections(fe).length > 0" class="mt-2">
                      <div class="text-xs text-gray-400 mb-1">已移除的小节</div>
                      <div class="space-y-1">
                        <div
                          v-for="sec in getRemovedSections(fe)"
                          :key="sec.key"
                          class="flex items-center gap-2 text-sm bg-gray-100 px-3 py-1.5 rounded border border-dashed border-gray-200"
                        >
                          <span class="text-gray-300 font-mono text-xs">—</span>
                          <span class="text-gray-400 flex-1">{{ sec.title }}</span>
                          <button
                            class="text-green-500 hover:text-green-600"
                            v-tooltip="'恢复此小节'"
                            @click.stop="restoreSectionInPart(ni, fi, sec.key)"
                          >
                            <span class="i-lucide-undo-2 w-3.5 h-3.5 inline-block align-middle" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ====== 直接 Feature（不在 Part 内） ====== -->
            <div
              v-else
              :data-entry-id="node.feature.id"
              class="card !p-0 overflow-hidden"
              :class="{ 'highlight-new': highlightedId === node.feature.id }"
            >
              <div
                class="flex items-center gap-3 px-4 py-3 cursor-pointer"
                @click="toggleExpand(ni)"
              >
                <div
                  v-if="canManageProject"
                  class="drag-handle cursor-grab text-gray-300 hover:text-gray-500 flex-shrink-0"
                >
                  <span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" />
                </div>
                <span class="text-sm font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{{
                  getGlobalFeatNum(ni)
                }}</span>
                <span
                  :class="expandedIndex === ni ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  class="w-4 h-4 text-gray-400 inline-block align-middle flex-shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-gray-900 text-sm flex items-center gap-2">
                    {{ node.feature.title }}
                    <span
                      v-if="node.feature.totalSections"
                      class="text-xs font-normal"
                      :class="
                        (node.feature.approvedSections ?? 0) === (node.feature.totalSections ?? 0)
                          ? 'text-green-500'
                          : 'text-gray-400'
                      "
                    >
                      ✓{{ node.feature.approvedSections ?? 0 }}/{{ node.feature.totalSections }}
                    </span>
                    <span
                      v-if="node.feature.categoryId && categoryInfo.has(node.feature.categoryId)"
                      class="text-xs font-normal px-1.5 py-0.5 rounded-full flex items-center gap-1"
                      :style="{
                        backgroundColor: categoryInfo.get(node.feature.categoryId)!.color + '18',
                        color: categoryInfo.get(node.feature.categoryId)!.color,
                      }"
                    >
                      <span
                        class="w-1.5 h-1.5 rounded-full"
                        :style="{
                          backgroundColor: categoryInfo.get(node.feature.categoryId)!.color,
                        }"
                      />
                      {{ categoryInfo.get(node.feature.categoryId)!.name }}
                    </span>
                  </div>
                  <div
                    v-if="node.feature.description"
                    class="text-xs text-gray-400 truncate mt-0.5"
                  >
                    {{ node.feature.description }}
                  </div>
                </div>
                <div
                  class="relative"
                  v-if="canManageProject && catalog.entries.some((e) => isPart(e))"
                >
                  <button
                    class="text-gray-300 hover:text-indigo-500 text-xs px-1.5 py-1 rounded"
                    v-tooltip="'移至篇'"
                    @click.stop="openMoveMenu($event, node.feature.id)"
                  >
                    <span class="i-lucide-log-in w-3.5 h-3.5 inline-block align-middle" />
                  </button>
                  <Teleport to="body">
                    <div
                      v-if="movingFeatureId === node.feature.id"
                      class="fixed inset-0 z-40"
                      @click="movingFeatureId = null"
                    >
                      <div
                        class="absolute bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]"
                        :style="{ top: `${moveMenuY}px`, left: `${moveMenuX}px` }"
                        @click.stop
                      >
                        <div class="text-xs text-gray-400 px-3 py-1">移至篇：</div>
                        <button
                          v-for="(en, eni) in catalog.entries"
                          :key="isPart(en) ? en.id : ''"
                          v-show="isPart(en)"
                          class="w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 flex items-center gap-2"
                          @click.stop="handleMoveToPart(node.feature.id, getPartId(en))"
                        >
                          <span
                            class="i-lucide-book-open w-3.5 h-3.5 inline-block align-middle text-indigo-400"
                          />
                          {{ (en as CatPart).title || '未命名篇' }}
                        </button>
                      </div>
                    </div>
                  </Teleport>
                </div>
                <button
                  v-if="canManageProject"
                  class="text-red-400 hover:text-red-600 text-sm"
                  @click.stop="removeFeature(ni)"
                >
                  <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
                </button>
              </div>

              <!-- 展开的 section 排序 -->
              <div
                v-if="expandedIndex === ni"
                class="border-t border-gray-100 bg-gray-50 px-4 py-2"
              >
                <div v-if="canManageProject" class="text-xs text-gray-400 mb-2">
                  小节排序（拖拽调整，点击 × 移除）
                </div>
                <div class="section-sort-area space-y-1" :data-feature-id="node.feature.id">
                  <div
                    v-for="(sec, si) in getOrderedSections(node)"
                    :key="sec.key"
                    class="flex items-center gap-2 text-sm bg-white px-3 py-1.5 rounded border border-gray-100 group"
                  >
                    <div
                      v-if="canManageProject"
                      class="section-drag-handle cursor-grab text-gray-300 hover:text-gray-500"
                    >
                      <span class="i-lucide-grip-vertical w-3.5 h-3.5 inline-block align-middle" />
                    </div>
                    <span class="text-gray-400 font-mono text-xs"
                      >{{ getGlobalFeatNum(ni) }}.{{ si + 1 }}</span
                    >
                    <span class="text-gray-700 flex-1">{{ sec.title }}</span>
                    <button
                      v-if="canManageProject"
                      class="text-red-400 hover:text-red-600"
                      v-tooltip="'移除此小节'"
                      @click.stop="removeSection(ni, sec.key)"
                    >
                      <span class="i-lucide-x w-3.5 h-3.5 inline-block align-middle" />
                    </button>
                  </div>
                </div>
                <!-- 已移除的小节 -->
                <div v-if="getRemovedSections(node).length > 0" class="mt-2">
                  <div class="text-xs text-gray-400 mb-1">已移除的小节</div>
                  <div class="space-y-1">
                    <div
                      v-for="sec in getRemovedSections(node)"
                      :key="sec.key"
                      class="flex items-center gap-2 text-sm bg-gray-100 px-3 py-1.5 rounded border border-dashed border-gray-200"
                    >
                      <span class="text-gray-300 font-mono text-xs">—</span>
                      <span class="text-gray-400 flex-1">{{ sec.title }}</span>
                      <button
                        class="text-green-500 hover:text-green-600"
                        v-tooltip="'恢复此小节'"
                        @click.stop="restoreSection(ni, sec.key)"
                      >
                        <span class="i-lucide-undo-2 w-3.5 h-3.5 inline-block align-middle" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </main>
    </div>
  </div>

  <!-- 编辑手册信息弹窗 -->
  <CreateEditManualModal
    :visible="showEditInfoModal"
    mode="edit"
    :catalog="{ id: catalogId, title: catalog.title, coverInfo: {} } as any"
    @close="showEditInfoModal = false"
    @saved="loadData().then(() => nextTick(() => initAllSorts()))"
  />

  <!-- 左侧池 "添加到部分" 下拉菜单 -->
  <Teleport to="body">
    <div v-if="movingPoolFeature" class="fixed inset-0 z-40" @click="movingPoolFeature = null">
      <div
        class="absolute bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]"
        :style="{ top: `${poolMenuY}px`, left: `${poolMenuX}px` }"
        @click.stop
      >
        <div class="text-xs text-gray-400 px-3 py-1">添加到篇：</div>
        <button
          v-for="(en, eni) in catalog.entries"
          :key="isPart(en) ? en.id : ''"
          v-show="isPart(en)"
          class="w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 flex items-center gap-2"
          @click.stop="handleAddToPart(getPartId(en), movingPoolFeature)"
        >
          <span class="i-lucide-folder w-3.5 h-3.5 inline-block align-middle text-indigo-400" />
          {{ (en as CatPart).title || '未命名篇' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 侧边栏抽屉过渡 */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: opacity 0.25s ease;
}
.slide-left-enter-from,
.slide-left-leave-to {
  opacity: 0;
}
.slide-left-enter-active aside,
.slide-left-leave-active aside {
  transition: transform 0.25s ease;
}
.slide-left-enter-from aside,
.slide-left-leave-to aside {
  transform: translateX(-100%);
}

@keyframes highlight-fade {
  from {
    background-color: #eff6ff;
  }
  to {
    background-color: transparent;
  }
}
.highlight-new {
  animation: highlight-fade 1.5s ease-out;
}
</style>
