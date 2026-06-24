<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Sortable from 'sortablejs'
import { useProject } from '@/composables/useProject'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import { getFeatures } from '@/api/endpoints/features'
import { getCatalogs, getCatalog, createCatalog, updateCatalog, deleteCatalog as apiDeleteCatalog } from '@/api/endpoints/catalogs'
import { getCategories } from '@/api/endpoints/categories'
import type { FeatureSummary, CatalogInfo, CategoryInfo } from '@shared/types'
import PageHeader from '@/components/PageHeader.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import EmptyState from '@/components/EmptyState.vue'

const route = useRoute()
const router = useRouter()
const { currentProjectId } = useProject()
const { isPM } = useAuth()
const { confirm, dangerConfirm } = useDialog()
const catalogId = computed(() => route.params.id as string)
const isNew = computed(() => catalogId.value === 'new')

const catalog = ref({
  title: '',
  targets: [] as string[],
  features: [] as any[],
})

const allFeatures = ref<any[]>([])
const catalogList = ref<any[]>([])
const categories = ref<any[]>([])
const searchQuery = ref('')
const saving = ref(false)
const saveError = ref('')
const expandedIndex = ref<number | null>(null)

// 解析 sections JSON 用于展示
function getSections(f: any): { key: string; title: string }[] {
  try { return JSON.parse(f.sections || '[]') }
  catch { return [] }
}

// 获取当前排序后的 sections（按 sectionOrder）
function getOrderedSections(entry: any) {
  const raw = getSections(entry.feature)
  if (entry.sectionOrder) {
    return entry.sectionOrder.map((k: string) => raw.find(s => s.key === k)).filter(Boolean) as typeof raw
  }
  return raw
}

const categoryInfo = computed(() => {
  const map = new Map<string, { name: string; color: string }>()
  for (const c of categories.value) {
    map.set(c.id, { name: c.name, color: c.color })
  }
  return map
})

const categoryMap = computed(() =>
  new Map(categories.value.map(c => [c.id, c.name]))
)

// 过滤可选主题
const filteredFeatures = computed(() => {
  const q = searchQuery.value.toLowerCase()
  const selectedIds = new Set(catalog.value.features.map((e: any) => e.feature.id))
  return allFeatures.value.filter((f: any) => {
    const catName = f.category_id ? categoryMap.value.get(f.category_id) || '' : ''
    return !selectedIds.has(f.id) &&
      (!q || f.title.toLowerCase().includes(q) || catName.toLowerCase().includes(q))
  })
})

// 按分类分组
const grouped = computed(() => {
  const groups: Record<string, any[]> = {}

  for (const f of filteredFeatures.value) {
    const catId = f.category_id || '__uncategorized__'
    if (!groups[catId]) groups[catId] = []
    groups[catId].push(f)
  }

  // 保持分类顺序，未分类放最后
  const sorted: Record<string, any[]> = {}
  const catOrder = [...categories.value].sort((a: any, b: any) => a.sort_order - b.sort_order)
  for (const c of catOrder) {
    if (groups[c.id]) sorted[c.id] = groups[c.id]
  }
  if (groups['__uncategorized__']) sorted['__uncategorized__'] = groups['__uncategorized__']
  return sorted
})

async function loadData() {
  const catalogIdVal = catalogId.value
  const pid = currentProjectId.value

  const [featuresRes, listRes, categoriesRes] = await Promise.all([
    getFeatures(pid || undefined),
    getCatalogs(pid || undefined),
    getCategories(pid || undefined),
  ])
  allFeatures.value = featuresRes as any
  catalogList.value = listRes as any
  categories.value = categoriesRes as any

  if (!isNew.value) {
    try {
      const data = await getCatalog(catalogIdVal) as any
      catalog.value = {
        title: data.title,
        targets: data.targets || [],
        features: (data.features || []).map((f: any) => ({
          feature: {
            id: f.id,
            title: f.title,
            description: f.description,
            sections: JSON.stringify(f.sections || []),
            category_id: f.category_id,
          },
          sectionOrder: f.sectionOrder,
        })),
      }
    } catch {
      // 无权访问或不存在，清空内容
      catalog.value = { title: '', targets: [], features: [] }
    }
  } else {
    catalog.value = { title: '', targets: [], features: [] }
  }
}

function addFeature(f: any) {
  catalog.value.features.push({ feature: f })
}

function removeFeature(index: number) {
  catalog.value.features.splice(index, 1)
  if (expandedIndex.value === index) expandedIndex.value = null
}

async function deleteCatalog(id: string) {
  if (!await dangerConfirm('确定删除此目录？\n导出版本历史也将被删除，不可恢复。')) return
  await apiDeleteCatalog(id)
  catalogList.value = catalogList.value.filter((c: any) => c.id !== id)
  // 如果删除的是当前目录，跳转到新建
  if (catalogId.value === id) {
    router.push('/catalogs/new')
  }
}

function toggleExpand(index: number) {
  expandedIndex.value = expandedIndex.value === index ? null : index
}

// section 拖拽排序
function updateSectionOrder(entryIndex: number, newOrder: string[]) {
  const entry = catalog.value.features[entryIndex]
  const defaultOrder = getSections(entry.feature).map(s => s.key)
  // 只有顺序跟默认不同时才保存
  const isSame = newOrder.length === defaultOrder.length && newOrder.every((k, i) => k === defaultOrder[i])
  entry.sectionOrder = isSame ? undefined : newOrder
}

async function save() {
  saveError.value = ''
  if (!catalog.value.title.trim()) {
    saveError.value = '请输入目录名称'
    saving.value = true
    saving.value = false
    return
  }
  saving.value = true
  try {
    const payload = {
      title: catalog.value.title.trim(),
      targets: catalog.value.targets,
      features: catalog.value.features.map((e: any) => ({
        featureId: e.feature.id,
        sectionOrder: e.sectionOrder,
      })),
      cover: {},
      projectId: currentProjectId.value || undefined,
    }

    if (isNew.value) {
      const res = await createCatalog(payload)
      router.replace(`/catalogs/${res.id}`)
    } else {
      await updateCatalog(catalogId.value, payload)
      // 刷新目录列表和当前数据
      await loadData()
      await nextTick()
      initSort()
    }
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
      initSort()
    })
  })
})

// 初始化拖拽（主题排序）
const sortList = ref<HTMLElement>()

function onDragStart(e: DragEvent, f: any) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('text/plain', f.id)
  e.dataTransfer.effectAllowed = 'copy'
}

function initSort() {
  if (!sortList.value) return
  const el = sortList.value as any
  if (el._sortable) el._sortable.destroy()
  Sortable.create(sortList.value, {
    animation: 200,
    handle: '.drag-handle',
    filter: '.drop-zone-placeholder',
    ghostClass: 'bg-blue-50',
    onEnd(evt) {
      if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
        const items = catalog.value.features
        const [moved] = items.splice(evt.oldIndex, 1)
        items.splice(evt.newIndex, 0, moved)
        expandedIndex.value = null
      }
    },
  })
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onDrop(e: DragEvent) {
  const featureId = e.dataTransfer?.getData('text/plain')
  if (!featureId) return
  const feature = allFeatures.value.find((f: any) => f.id === featureId)
  if (feature) addFeature(feature)
}

// section 拖拽初始化
function initSectionSort(index: number) {
  const container = sortList.value?.querySelectorAll('.section-sort-area')[index] as HTMLElement | undefined
  if (!container) return
  const el = container as any
  if (el._sortable) el._sortable.destroy()
  Sortable.create(container, {
    animation: 200,
    handle: '.section-drag-handle',
    ghostClass: 'bg-blue-50',
    onEnd(evt) {
      if (evt.oldIndex === undefined || evt.newIndex === undefined) return
      const entry = catalog.value.features[index]
      const ordered = getOrderedSections(entry)
      const [moved] = ordered.splice(evt.oldIndex, 1)
      ordered.splice(evt.newIndex, 0, moved)
      updateSectionOrder(index, ordered.map(s => s.key))
    },
  })
}

// 展开时初始化 section 拖拽
watch(expandedIndex, async (newVal) => {
  if (newVal !== null) {
    await nextTick()
    initSectionSort(newVal)
  }
})

onMounted(async () => {
  await loadData()
  await nextTick()
  initSort()
})

// 目录内容变化时重建右侧拖拽
watch(() => catalog.value.features.length, async () => {
  await nextTick()
  initSort()
})

watch(currentProjectId, () => {
  loadData().then(() => {
    // 切换项目后，如果当前目录不属于新项目，跳转到新建
    if (!isNew.value && !catalogList.value.some((c: any) => c.id === catalogId.value)) {
      router.replace('/catalogs/new')
    }
    nextTick(() => {
      initSort()
    })
  })
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 头部 -->
    <PageHeader>
      <template #left>
        <router-link to="/features" class="text-gray-400 hover:text-gray-600"><span class="i-lucide-arrow-left w-4 h-4 inline-block align-middle mr-1" />返回</router-link>
        <input v-model="catalog.title" class="text-lg font-semibold bg-transparent border-none outline-none" placeholder="目录名称" :readonly="!isPM" />
      </template>
      <template #right>
        <ErrorMessage :message="saveError" />
        <button class="btn-secondary text-sm" @click="router.push(`/preview/${catalogId}`)">预览</button>
        <button class="btn-primary text-sm" v-if="isPM" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
      </template>
    </PageHeader>

    <!-- 已保存目录列表 -->
    <div v-if="catalogList.length > 0" class="flex items-center gap-2 px-6 py-2 bg-gray-50 border-b border-gray-200 overflow-x-auto">
      <span class="text-xs text-gray-400 flex-shrink-0">已保存的目录：</span>
      <button
        v-for="c in catalogList"
        :key="c.id"
        class="text-xs px-2.5 py-1 rounded-full transition-colors flex-shrink-0 flex items-center gap-1"
        :class="catalogId === c.id ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-200'"
        @click="router.push(`/catalogs/${c.id}`)"
      >
        {{ c.title }}
        <span
          v-if="isPM"
          class="text-red-400 hover:text-red-600"
          @click.stop="deleteCatalog(c.id)"
        ><span class="i-lucide-x w-4 h-4 inline-block align-middle" /></span>
      </button>
      <button
        v-if="isPM"
        class="text-xs px-2.5 py-1 rounded-full text-gray-400 hover:bg-gray-200 flex-shrink-0 inline-flex items-center gap-0.5"
        @click="router.push('/catalogs/new')"
      >
        <span class="i-lucide-plus w-3.5 h-3.5" />新建
      </button>
    </div>

    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧：可选主题（仅 PM 可编辑） -->
      <aside v-if="isPM" class="w-72 border-r border-gray-200 bg-white flex-shrink-0 flex flex-col">
        <div class="p-4 flex-shrink-0">
          <input
            v-model="searchQuery"
            class="input text-sm"
            placeholder="搜索主题..."
          />
        </div>

        <div class="flex-1 overflow-y-auto px-4 pb-3">
          <template v-for="(items, catId) in grouped" :key="catId">
            <div class="text-xs font-semibold text-gray-400 uppercase mb-2 mt-3 flex items-center gap-1.5 left-pool-header">
              <span
                v-if="catId !== '__uncategorized__' && categoryInfo.has(catId)"
                class="w-2 h-2 rounded-full flex-shrink-0"
                :style="{ backgroundColor: categoryInfo.get(catId)!.color }"
              />
              <span v-if="catId === '__uncategorized__'" class="text-gray-300">未分类</span>
              <span v-else>{{ categoryInfo.get(catId)?.name || catId }}</span>
            </div>
            <button
              v-for="f in items"
              :key="f.id"
              :data-feature-id="f.id"
              draggable="true"
              class="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors mb-1 flex items-center gap-2 group cursor-grab"
              @click="addFeature(f)"
              @dragstart="onDragStart($event, f)"
            >
              <span class="flex-1 text-gray-700">{{ f.title }}</span>
              <span v-if="f.total_sections" class="text-xs text-gray-400 flex-shrink-0">
                {{ f.approved_sections ?? 0 }}/{{ f.total_sections }}
              </span>
              <span class="text-gray-300 opacity-0 group-hover:opacity-100"><span class="i-lucide-plus w-4 h-4 inline-block align-middle" /></span>
            </button>
          </template>

          <EmptyState v-if="Object.keys(grouped).length === 0" title="暂无可用主题" />
        </div>
      </aside>

      <!-- 右侧：已编排主题 -->
      <main
        class="flex-1 overflow-y-auto bg-gray-50 p-6"
        @dragover="onDragOver"
        @drop="onDrop"
      >
        <div ref="sortList" class="space-y-2 max-w-2xl" :class="{ 'min-h-[240px]': catalog.features.length === 0 }">
          <!-- 空状态 / 拖放目标区 -->
          <div
            v-if="catalog.features.length === 0"
            class="drop-zone-placeholder border-2 border-dashed border-gray-300 rounded-xl h-48 flex flex-col items-center justify-center text-gray-400 transition-colors hover:border-blue-400 hover:text-blue-400"
          >
            <span class="i-lucide-book-open text-3xl mb-3 opacity-40" />
            <span class="text-sm">从左侧拖入或点击主题添加到目录</span>
          </div>

          <div
            v-for="(entry, i) in catalog.features"
            :key="entry.feature.id"
            class="card !p-0 overflow-hidden"
          >
            <!-- 主题行 -->
            <div class="flex items-center gap-3 px-4 py-3">
              <div v-if="isPM" class="drag-handle cursor-grab text-gray-300 hover:text-gray-500 text-lg"><span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" /></div>
              <span class="text-sm font-mono text-gray-300 bg-gray-100 px-2 py-0.5 rounded">
                {{ i + 1 }}
              </span>
              <button
                class="text-xs text-gray-400 hover:text-gray-600 w-5 h-5 flex items-center justify-center rounded"
                @click="toggleExpand(i)"
              >
                <span :class="expandedIndex === i ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="w-4 h-4 inline-block align-middle" />
              </button>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-gray-900 text-sm flex items-center gap-2">
                  {{ entry.feature.title }}
                  <span v-if="entry.feature.total_sections" class="text-xs font-normal" :class="(entry.feature.approved_sections ?? 0) === (entry.feature.total_sections ?? 0) ? 'text-green-500' : 'text-gray-400'">
                    ✓{{ entry.feature.approved_sections ?? 0 }}/{{ entry.feature.total_sections }}
                  </span>
                </div>
                <div class="text-xs text-gray-400 flex items-center gap-1.5">
                  <template v-if="entry.feature.category_id && categoryInfo.has(entry.feature.category_id)">
                    <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ backgroundColor: categoryInfo.get(entry.feature.category_id)!.color }" />
                    {{ categoryInfo.get(entry.feature.category_id)!.name }} ·
                  </template>
                  {{ entry.feature.id }}
                </div>
              </div>
              <button
                v-if="isPM"
                class="text-gray-300 hover:text-red-500 text-sm"
                @click.stop="removeFeature(i)"
              >
                <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
              </button>
            </div>

            <!-- 展开的 section 排序 -->
            <div v-if="expandedIndex === i" class="border-t border-gray-100 bg-gray-50 px-4 py-2">
              <div v-if="isPM" class="text-xs text-gray-400 mb-2">章节排序（拖拽调整）</div>
              <div class="section-sort-area space-y-1">
                <div
                  v-for="sec in getOrderedSections(entry)"
                  :key="sec.key"
                  class="flex items-center gap-2 text-sm bg-white px-3 py-1.5 rounded border border-gray-100"
                >
                  <div v-if="isPM" class="section-drag-handle cursor-grab text-gray-300 hover:text-gray-500"><span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" /></div>
                  <span class="text-gray-500 font-mono text-xs">{{ sec.key }}</span>
                  <span class="text-gray-700">{{ sec.title }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
