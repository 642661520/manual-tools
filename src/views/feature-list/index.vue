<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { useDialog } from '@/composables/useDialog'
import Sortable from 'sortablejs'
import FormField from '@/components/FormField.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import SelectDropdown from '@/components/SelectDropdown.vue'
import ColorPicker from '@/components/ColorPicker.vue'
import {
  getFeatures,
  createFeature,
  updateFeature,
  deleteFeature,
  getFeature,
} from '@/api/endpoints/features'
import {
  getCategories,
  createCategory as apiCreateCategory,
  updateCategory,
  deleteCategory as apiDeleteCategory,
} from '@/api/endpoints/categories'
import type { FeatureSummary, CategoryInfo, SectionDef } from '@shared/types'
import { parseSections } from '@shared/utils/sections'

// API 响应已自动转为 camelCase
type FeatureRow = FeatureSummary & {
  orphanedCount: number
  approvedSections: number
  totalSections: number
  completedSections: number
  editedSections: number
  categoryId: string | null
}
type CategoryItem = CategoryInfo & { sortOrder: number }

const router = useRouter()
const { canManageProject } = useAuth()
const { currentProjectId } = useProject()
const { confirm, dangerConfirm } = useDialog()
const features = ref<FeatureRow[]>([])
const loading = ref(true)
const expandedFeatureId = ref<string | null>(null)

function toggleExpand(featureId: string) {
  expandedFeatureId.value = expandedFeatureId.value === featureId ? null : featureId
}
const showFeatureDialog = ref(false)
const featureDialogMode = ref<'create' | 'edit'>('create')
const featureFormError = ref('')
const featureForm = ref({
  title: '',
  description: '',
  categoryId: null as string | null,
  sections: [] as SectionDef[],
})
const featureFormId = ref<string | null>(null)
const newSectionTitle = ref('')
const featureSectionSortEl = ref<HTMLElement>()
let featureSectionSortable: Sortable | null = null

function generateKey(): string {
  return crypto.randomUUID().slice(0, 8)
}

function openCreateDialog() {
  featureDialogMode.value = 'create'
  featureFormId.value = null
  featureForm.value = { title: '', description: '', categoryId: null, sections: [] }
  featureFormError.value = ''
  newSectionTitle.value = ''
  showFeatureDialog.value = true
}

async function openEditDialog(featureId: string) {
  try {
    const data = await getFeature(featureId)
    featureDialogMode.value = 'edit'
    featureFormId.value = data.id
    featureForm.value = {
      title: data.title,
      description: data.description,
      categoryId: data.categoryId || null,
      sections: data.sections.map((s) => ({ key: s.key, title: s.title })),
    }
    featureFormError.value = ''
    newSectionTitle.value = ''
    showFeatureDialog.value = true
  } catch (e) {
    console.error('Failed to load feature:', e)
  }
}

function addSection() {
  const title = newSectionTitle.value.trim()
  if (!title) {
    featureFormError.value = '请输入小节标题'
    return
  }
  featureFormError.value = ''
  featureForm.value.sections.push({ key: generateKey(), title })
  newSectionTitle.value = ''
}

async function removeSection(index: number) {
  if (featureDialogMode.value === 'edit' && featureForm.value.sections.length <= 1) {
    if (!(await confirm('删除最后一个小节将导致章节无法保存，确定删除？'))) return
  }
  featureForm.value.sections.splice(index, 1)
}

async function saveFeature() {
  featureFormError.value = ''
  if (!featureForm.value.title.trim()) {
    featureFormError.value = '请输入章节名称'
    return
  }
  try {
    if (featureDialogMode.value === 'create') {
      await createFeature({
        title: featureForm.value.title,
        description: featureForm.value.description,
        sections: featureForm.value.sections,
        categoryId: featureForm.value.categoryId ?? undefined,
        projectId: currentProjectId.value ?? undefined,
      })
    } else {
      await updateFeature(featureFormId.value!, {
        title: featureForm.value.title,
        description: featureForm.value.description,
        sections: featureForm.value.sections,
        categoryId: featureForm.value.categoryId ?? undefined,
      })
    }
    showFeatureDialog.value = false
    featureForm.value = { title: '', description: '', categoryId: null, sections: [] }
    await loadFeatures()
  } catch (e: unknown) {
    featureFormError.value = e instanceof Error ? e.message : '网络错误，保存失败'
  }
}

function initFeatureSectionSort() {
  if (featureSectionSortable) {
    featureSectionSortable.destroy()
    featureSectionSortable = null
  }
  if (!featureSectionSortEl.value) return
  featureSectionSortable = Sortable.create(featureSectionSortEl.value, {
    animation: 200,
    handle: '.drag-handle',
    ghostClass: 'bg-blue-50',
    onEnd(evt) {
      if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
        const items = featureForm.value.sections
        const [moved] = items.splice(evt.oldIndex, 1)
        items.splice(evt.newIndex, 0, moved)
      }
    },
  })
}

// 分类管理
const categories = ref<CategoryItem[]>([])
const showCategoryDialog = ref(false)
const categoryError = ref('')
const newCategory = ref({ name: '', color: '#6366f1' })
const editingCategory = ref<CategoryItem | null>(null)
const editCategoryForm = ref({ name: '', color: '#6366f1' })
const categorySortEl = ref<HTMLElement>()
const categorySaving = ref(false)

const categoryFeatureCount = computed(() => {
  const counts = new Map<string, number>()
  for (const f of features.value) {
    if (f.categoryId) {
      counts.set(f.categoryId, (counts.get(f.categoryId) || 0) + 1)
    }
  }
  return counts
})

async function loadCategories() {
  try {
    categories.value = (await getCategories(
      currentProjectId.value ?? undefined,
    )) as unknown as CategoryItem[]
  } catch {
    /* ignore */
  }
}

function initCategorySort() {
  if (!categorySortEl.value) return
  Sortable.create(categorySortEl.value, {
    animation: 200,
    handle: '.cat-drag-handle',
    ghostClass: 'bg-blue-50',
    onEnd: async (evt) => {
      if (evt.oldIndex === undefined || evt.newIndex === undefined) return
      const item = categories.value.splice(evt.oldIndex, 1)[0]
      categories.value.splice(evt.newIndex, 0, item)
      await saveCategoryOrder()
    },
  })
}

async function saveCategoryOrder() {
  categorySaving.value = true
  try {
    for (let i = 0; i < categories.value.length; i++) {
      const c = categories.value[i]
      if (c.sortOrder !== i + 1) {
        c.sortOrder = i + 1
        await updateCategory(c.id, { name: c.name, color: c.color, sortOrder: c.sortOrder })
      }
    }
  } catch (e: unknown) {
    categoryError.value = e instanceof Error ? e.message : '排序保存失败'
    await loadCategories()
  } finally {
    categorySaving.value = false
  }
}

async function createCategory() {
  categoryError.value = ''
  if (!newCategory.value.name.trim()) {
    categoryError.value = '请输入分类名称'
    return
  }
  try {
    await apiCreateCategory({
      name: newCategory.value.name,
      color: newCategory.value.color,
      projectId: currentProjectId.value ?? undefined,
    })
    newCategory.value = { name: '', color: '#6366f1' }
    await loadCategories()
  } catch (e: unknown) {
    categoryError.value = e instanceof Error ? e.message : '网络错误'
  }
}

function openEditCategory(c: CategoryItem) {
  editingCategory.value = c
  editCategoryForm.value = { name: c.name, color: c.color }
}

async function saveEditCategory() {
  if (!editingCategory.value) return
  categoryError.value = ''
  if (!editCategoryForm.value.name.trim()) {
    categoryError.value = '请输入分类名称'
    return
  }
  try {
    await updateCategory(editingCategory.value.id, {
      name: editCategoryForm.value.name,
      color: editCategoryForm.value.color,
      sortOrder: editingCategory.value.sortOrder,
    })
    editingCategory.value = null
    await loadCategories()
  } catch (e: unknown) {
    categoryError.value = e instanceof Error ? e.message : '网络错误'
  }
}

async function deleteCategory(id: string) {
  const count = categoryFeatureCount.value.get(id) || 0
  const msg =
    count > 0 ? `确定删除此分类？该分类下有 ${count} 个章节将变为"未分类"。` : '确定删除此分类？'
  if (!(await dangerConfirm(msg))) return
  await apiDeleteCategory(id)
  await loadCategories()
}

const categoryInfo = computed(() => {
  const map = new Map<string, { name: string; color: string }>()
  for (const c of categories.value) {
    map.set(c.id, { name: c.name, color: c.color })
  }
  return map
})

const groupedFeatures = computed(() => {
  const groups: Record<string, FeatureRow[]> = {}

  for (const f of features.value) {
    const catId = f.categoryId || '__uncategorized__'
    if (!groups[catId]) groups[catId] = []
    groups[catId].push(f)
  }

  // 保持分类顺序（按 sort_order），未分类放最后
  const sorted: Record<string, FeatureRow[]> = {}
  const catOrder = [...categories.value].sort((a, b) => a.sortOrder - b.sortOrder)
  for (const c of catOrder) {
    if (groups[c.id]) sorted[c.id] = groups[c.id]
  }
  if (groups['__uncategorized__']) sorted['__uncategorized__'] = groups['__uncategorized__']
  return sorted
})

function getOverallStatus(f: FeatureRow): 'draft' | 'in_progress' | 'pending_review' | 'approved' {
  if (f.approvedSections === f.totalSections && f.totalSections > 0) return 'approved'
  if (f.completedSections > 0) return 'pending_review'
  if (f.editedSections > 0) return 'in_progress'
  return 'draft'
}

async function loadFeatures() {
  loading.value = true
  try {
    const [fetchedFeatures, fetchedCategories] = await Promise.all([
      getFeatures(currentProjectId.value ?? undefined),
      getCategories(currentProjectId.value ?? undefined),
    ])
    features.value = fetchedFeatures as unknown as FeatureRow[]
    categories.value = fetchedCategories as unknown as CategoryItem[]
  } finally {
    loading.value = false
  }
}

watch(showFeatureDialog, async (val) => {
  if (val) {
    await nextTick()
    initFeatureSectionSort()
  } else {
    if (featureSectionSortable) {
      featureSectionSortable.destroy()
      featureSectionSortable = null
    }
  }
})

watch(showCategoryDialog, async (val) => {
  if (val) {
    await nextTick()
    initCategorySort()
  }
})

async function deleteCustomFeature(id: string) {
  const f = features.value.find((f) => f.id === id)
  const msg = f
    ? `确定删除「${f.title}」？\n${f.totalSections} 个小节文档将被一并删除，不可恢复。`
    : '确定删除此章节？'
  if (!(await dangerConfirm(msg))) return
  await deleteFeature(id)
  await loadFeatures()
}

function openEditor(id: string) {
  router.push(`/features/${id}/edit`)
}

onMounted(loadFeatures)
watch(currentProjectId, loadFeatures)
</script>

<template>
  <div class="h-full flex flex-col max-w-6xl mx-auto">
    <div class="flex-shrink-0 flex items-center justify-between mb-6 px-6 pt-6">
      <div>
        <h1 class="text-2xl font-bold">章节列表</h1>
        <p class="text-sm text-gray-500 mt-1">章节骨架管理与状态总览</p>
      </div>
      <div class="flex items-center gap-3">
        <button
          v-if="canManageProject"
          class="btn-secondary text-sm"
          @click="showCategoryDialog = true"
        >
          <span class="i-lucide-tag w-4 h-4 inline-block align-middle mr-1" />分类管理
        </button>
        <button v-if="canManageProject" class="btn-secondary text-sm" @click="openCreateDialog">
          <span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />自定义章节
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-6 pb-6">
      <LoadingState v-if="loading" />
      <template v-else>
        <div v-for="(items, catId) in groupedFeatures" :key="catId" class="mb-8">
          <h2 class="text-sm font-semibold text-gray-400 uppercase mb-3 flex items-center gap-2">
            <span
              v-if="catId !== '__uncategorized__' && categoryInfo.has(catId)"
              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
              :style="{ backgroundColor: categoryInfo.get(catId)!.color }"
            />
            <span v-if="catId === '__uncategorized__'" class="text-gray-300">未分类</span>
            <span v-else>{{ categoryInfo.get(catId)?.name || catId }}</span>
          </h2>
          <div class="card divide-y divide-gray-100 p-0 overflow-hidden">
            <template v-for="f in items" :key="f.id">
              <div
                class="flex items-center gap-3 px-6 py-4 hover:bg-gray-50 transition-colors group"
                :class="expandedFeatureId === f.id ? 'bg-blue-50/50' : ''"
                :style="
                  catId !== '__uncategorized__'
                    ? { borderLeft: `3px solid ${categoryInfo.get(catId)?.color || 'transparent'}` }
                    : {}
                "
              >
                <!-- 展开按钮 -->
                <button
                  class="text-gray-300 hover:text-gray-500 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors"
                  @click.stop="toggleExpand(f.id)"
                >
                  <span
                    class="i-lucide-chevron-right w-4 h-4 inline-block align-middle transition-transform duration-200"
                    :class="{ 'rotate-90': expandedFeatureId === f.id }"
                  />
                </button>
                <div class="flex-1 min-w-0 cursor-pointer" @click="openEditor(f.id)">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-gray-900">{{ f.title }}</span>
                    <span class="text-xs text-gray-400 font-mono">{{ f.id }}</span>
                    <span
                      v-if="f.orphanedCount > 0"
                      class="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                      v-tooltip="`${f.orphanedCount} 个游离文档`"
                      ><span class="i-lucide-alert-triangle w-3 h-3 inline-block align-middle" />{{
                        f.orphanedCount
                      }}</span
                    >
                  </div>
                  <p class="text-sm text-gray-500 mt-0.5 truncate">{{ f.description }}</p>
                </div>
                <div class="flex items-center gap-4 text-sm flex-shrink-0">
                  <span class="text-xs text-gray-400"
                    >{{ f.approvedSections ?? 0 }}/{{ f.totalSections ?? 0 }} 已审核</span
                  >
                  <StatusBadge :status="getOverallStatus(f)" variant="badge" />
                  <button
                    v-if="canManageProject"
                    class="text-blue-400 hover:text-blue-600 text-sm"
                    @click.stop="openEditDialog(f.id)"
                  >
                    设置
                  </button>
                  <button
                    v-if="canManageProject"
                    class="text-red-400 hover:text-red-600 text-sm"
                    @click.stop="deleteCustomFeature(f.id)"
                  >
                    <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
                  </button>
                </div>
              </div>
              <!-- 展开的小节列表 -->
              <div
                v-if="expandedFeatureId === f.id"
                class="bg-gray-50 px-10 py-3 border-t border-gray-100"
              >
                <div class="text-xs text-gray-400 mb-2">小节</div>
                <div class="space-y-1">
                  <div
                    v-for="sec in parseSections(f.sections)"
                    :key="sec.key"
                    class="flex items-center gap-3 text-sm py-1.5 px-3 rounded hover:bg-white cursor-pointer transition-colors"
                    @click="openEditor(f.id)"
                  >
                    <span class="text-gray-700">{{ sec.title }}</span>
                  </div>
                  <!-- 无显式小节但有默认小节文档 -->
                  <div
                    v-if="parseSections(f.sections).length === 0 && f.totalSections > 0"
                    class="flex items-center gap-3 text-sm py-1.5 px-3 rounded hover:bg-white cursor-pointer transition-colors"
                    @click="openEditor(f.id)"
                  >
                    <span class="text-gray-700">正文</span>
                    <span class="text-xs text-gray-400">默认小节</span>
                  </div>
                  <div
                    v-if="parseSections(f.sections).length === 0 && f.totalSections === 0"
                    class="text-xs text-gray-400 py-2"
                  >
                    暂无小节
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
        <EmptyState
          v-if="features.length === 0"
          icon="i-lucide-clipboard-list"
          title="暂无章节骨架"
          description="点击「自定义章节」创建第一个章节"
        />
      </template>
    </div>

    <!-- 新建/编辑章节 -->
    <div
      v-if="showFeatureDialog"
      class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
    >
      <div
        class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div
          class="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0"
        >
          <h2 class="text-lg font-semibold">
            {{ featureDialogMode === 'create' ? '新建自定义章节' : '章节设置' }}
          </h2>
          <button
            class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
            @click="showFeatureDialog = false"
          >
            <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
          </button>
        </div>
        <div class="p-6 overflow-y-auto flex-1">
          <ErrorMessage :message="featureFormError" class="mb-4" />
          <div class="space-y-4">
            <FormField label="章节名称" :required="true">
              <input v-model="featureForm.title" class="input" placeholder="如：常见问题" />
            </FormField>
            <FormField label="所属分类">
              <SelectDropdown
                v-model="featureForm.categoryId"
                :options="[
                  { value: null, label: '未分类' },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]"
              />
            </FormField>
            <FormField label="章节描述">
              <textarea
                v-model="featureForm.description"
                class="textarea"
                rows="2"
                placeholder="简要描述章节用途"
              />
            </FormField>
            <div>
              <label class="label">小节</label>
              <div
                v-if="featureForm.sections.length > 0"
                ref="featureSectionSortEl"
                class="mb-3 space-y-1"
              >
                <div
                  v-for="(s, i) in featureForm.sections"
                  :key="s.key"
                  class="flex items-center gap-2 text-sm bg-gray-50 px-3 py-1.5 rounded"
                >
                  <div class="drag-handle cursor-grab text-gray-300 hover:text-gray-500">
                    <span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" />
                  </div>
                  <span class="flex-1 text-gray-700">{{ s.title }}</span>
                  <button
                    class="text-red-400 hover:text-red-600 text-xs p-1"
                    @click="removeSection(i)"
                  >
                    <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
                  </button>
                </div>
              </div>
              <div class="flex gap-2">
                <input
                  v-model="newSectionTitle"
                  class="input flex-1"
                  placeholder="小节标题"
                  @keyup.enter="addSection"
                />
                <button class="btn-secondary text-sm flex-shrink-0" @click="addSection">
                  添加
                </button>
              </div>
              <p class="text-xs text-gray-400 mt-1">拖拽可调整小节顺序，可留空使用默认小节</p>
            </div>
          </div>
        </div>
        <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button class="btn-secondary" @click="showFeatureDialog = false">取消</button>
          <button class="btn-primary" @click="saveFeature">
            {{ featureDialogMode === 'create' ? '创建' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 分类管理 -->
    <div
      v-if="showCategoryDialog"
      class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
    >
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 class="text-lg font-semibold">分类管理</h2>
          <button
            class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
            @click="showCategoryDialog = false"
          >
            <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
          </button>
        </div>
        <div class="p-6">
          <ErrorMessage :message="categoryError" class="mb-4" />
          <div class="flex items-end gap-2 pb-4 border-b border-gray-100">
            <FormField label="分类名称" class="flex-1">
              <input
                v-model="newCategory.name"
                class="input"
                placeholder="如：系统管理"
                @keyup.enter="createCategory"
              />
            </FormField>
            <FormField label="颜色">
              <ColorPicker v-model="newCategory.color" />
            </FormField>
            <div>
              <label class="label invisible">-</label>
              <button class="btn-primary text-sm h-[42px]" @click="createCategory">添加</button>
            </div>
          </div>

          <div v-if="categories.length > 0" ref="categorySortEl" class="mt-4 space-y-1">
            <div
              v-for="c in categories"
              :key="c.id"
              class="flex items-center gap-3 py-2.5 px-2 rounded hover:bg-gray-50 transition-colors"
            >
              <div
                class="cat-drag-handle cursor-grab text-gray-300 hover:text-gray-500 flex-shrink-0"
              >
                <span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" />
              </div>
              <span
                class="w-3.5 h-3.5 rounded-full flex-shrink-0"
                :style="{ backgroundColor: c.color }"
              ></span>
              <div
                v-if="editingCategory?.id !== c.id"
                class="flex-1 flex items-center gap-2 min-w-0"
              >
                <span class="font-medium text-sm truncate">{{ c.name }}</span>
                <span class="text-xs text-gray-400 flex-shrink-0"
                  >{{ categoryFeatureCount.get(c.id) || 0 }} 个章节</span
                >
              </div>
              <div v-else class="flex-1 flex items-center gap-2">
                <input
                  v-model="editCategoryForm.name"
                  class="input text-sm flex-1"
                  @keyup.enter="saveEditCategory"
                />
                <ColorPicker v-model="editCategoryForm.color" class="flex-shrink-0" />
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <template v-if="editingCategory?.id === c.id">
                  <button
                    class="text-green-500 hover:text-green-700 text-sm"
                    @click="saveEditCategory"
                  >
                    保存
                  </button>
                  <button
                    class="text-gray-400 hover:text-gray-600 text-sm"
                    @click="editingCategory = null"
                  >
                    取消
                  </button>
                </template>
                <template v-else>
                  <button
                    class="text-blue-400 hover:text-blue-600 text-sm"
                    @click="openEditCategory(c)"
                  >
                    编辑
                  </button>
                  <button
                    class="text-red-400 hover:text-red-600 text-sm"
                    @click="deleteCategory(c.id)"
                  >
                    <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
                  </button>
                </template>
              </div>
            </div>
          </div>
          <EmptyState
            v-if="categories.length === 0"
            title="暂无分类"
            description="点击上方添加按钮创建第一个分类"
          />
          <p v-if="categories.length > 1" class="text-xs text-gray-400 mt-3">
            拖拽
            <span class="i-lucide-grip-vertical w-3 h-3 inline-block align-middle" />
            图标可调整分类排序
          </p>
        </div>
        <div class="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button class="btn-secondary" @click="showCategoryDialog = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
