<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { useDialog } from '@/composables/useDialog'
import { showErrorToast, showSuccessToast } from '@/composables/toast'
import Sortable from 'sortablejs'
import FormField from '@/components/FormField.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import SelectDropdown from '@/components/SelectDropdown.vue'
import ColorPicker from '@/components/ColorPicker.vue'
import CheckboxField from '@/components/CheckboxField.vue'
import {
  getFeatures,
  createFeature,
  updateFeature,
  deleteFeature,
  getFeature,
  updateSections,
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
const { isProjectPM } = useAuth()
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
  createDefaultSection: true,
})
const featureFormId = ref<string | null>(null)

function generateKey(): string {
  return crypto.randomUUID().slice(0, 8)
}

function openCreateDialog() {
  featureDialogMode.value = 'create'
  featureFormId.value = null
  featureForm.value = {
    title: '',
    description: '',
    categoryId: null,
    sections: [],
    createDefaultSection: true,
  }
  featureFormError.value = ''
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
      sections: [] as SectionDef[],
      createDefaultSection: false,
    }
    featureFormError.value = ''
    showFeatureDialog.value = true
  } catch (e) {
    console.error('Failed to load feature:', e)
  }
}

async function saveFeature() {
  featureFormError.value = ''
  if (!featureForm.value.title.trim()) {
    featureFormError.value = '请输入内容名称'
    return
  }
  try {
    if (featureDialogMode.value === 'create') {
      await createFeature({
        title: featureForm.value.title,
        description: featureForm.value.description,
        categoryId: featureForm.value.categoryId ?? undefined,
        projectId: currentProjectId.value ?? undefined,
        createDefaultSection: featureForm.value.createDefaultSection,
      })
    } else {
      await updateFeature(featureFormId.value!, {
        title: featureForm.value.title,
        description: featureForm.value.description,
        categoryId: featureForm.value.categoryId ?? undefined,
      })
    }
    showFeatureDialog.value = false
    featureForm.value = {
      title: '',
      description: '',
      categoryId: null,
      sections: [],
      createDefaultSection: true,
    }
    await loadFeatures()
    showSuccessToast(featureDialogMode.value === 'create' ? '内容已创建' : '内容已更新')
  } catch (e: unknown) {
    featureFormError.value = e instanceof Error ? e.message : '网络错误，保存失败'
  }
}

// ---- 展开列表内联小节管理 ----

const sectionAddInputs = reactive<Record<string, string>>({})
const sectionSortables = new Map<string, Sortable>()

function getSectionAddInput(featureId: string): string {
  if (!(featureId in sectionAddInputs)) {
    sectionAddInputs[featureId] = ''
  }
  return sectionAddInputs[featureId]
}
function setSectionAddInput(featureId: string, val: string) {
  sectionAddInputs[featureId] = val
}

async function addSectionInline(featureId: string) {
  const title = (sectionAddInputs[featureId] || '').trim()
  if (!title) return
  const feat = features.value.find((f) => f.id === featureId)
  if (!feat) return
  const currentSections = parseSections(feat.sections)
  const newSections = [...currentSections, { key: generateKey(), title }]
  try {
    await updateSections(featureId, { sections: newSections })
    sectionAddInputs[featureId] = ''
    await loadFeatures()
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '添加小节失败')
  }
}

async function removeSectionInline(featureId: string, index: number) {
  const feat = features.value.find((f) => f.id === featureId)
  if (!feat) return
  const currentSections = parseSections(feat.sections)
  const removed = currentSections[index]
  if (!(await dangerConfirm(`确定删除小节「${removed.title}」？\n已编辑的内容将变为游离文档。`)))
    return
  const newSections = currentSections.filter((_, i) => i !== index)
  try {
    await updateSections(featureId, { sections: newSections })
    await loadFeatures()
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '删除小节失败')
  }
}

function initSectionSort(featureId: string, el: HTMLElement | null) {
  // 清理旧实例
  const old = sectionSortables.get(featureId)
  if (old) old.destroy()
  sectionSortables.delete(featureId)

  if (!el) return
  const sortable = Sortable.create(el, {
    animation: 200,
    handle: '.drag-handle',
    ghostClass: 'bg-active',
    onEnd: async (evt) => {
      if (evt.oldIndex === undefined || evt.newIndex === undefined) return
      if (evt.oldIndex === evt.newIndex) return
      const feat = features.value.find((f) => f.id === featureId)
      if (!feat) return
      const items = [...parseSections(feat.sections)]
      const [moved] = items.splice(evt.oldIndex, 1)
      items.splice(evt.newIndex, 0, moved)
      try {
        await updateSections(featureId, { sections: items })
        await loadFeatures()
      } catch (e: unknown) {
        showErrorToast(e instanceof Error ? e.message : '排序保存失败')
      }
    },
  })
  sectionSortables.set(featureId, sortable)
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
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '加载分类失败')
  }
}

function initCategorySort() {
  if (!categorySortEl.value) return
  Sortable.create(categorySortEl.value, {
    animation: 200,
    handle: '.cat-drag-handle',
    ghostClass: 'bg-active',
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
    showSuccessToast('分类已创建')
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
    showSuccessToast('分类已更新')
  } catch (e: unknown) {
    categoryError.value = e instanceof Error ? e.message : '网络错误'
  }
}

async function deleteCategory(id: string) {
  const count = categoryFeatureCount.value.get(id) || 0
  const msg =
    count > 0 ? `确定删除此分类？该分类下有 ${count} 个内容将变为"未分类"。` : '确定删除此分类？'
  if (!(await dangerConfirm(msg))) return
  try {
    await apiDeleteCategory(id)
    await loadCategories()
    showSuccessToast('分类已删除')
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '删除分类失败')
  }
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
    : '确定删除此内容？'
  if (!(await dangerConfirm(msg))) return
  try {
    await deleteFeature(id)
    await loadFeatures()
    showSuccessToast('内容已删除')
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '删除内容失败')
  }
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
        <h1 class="text-2xl font-bold">内容列表</h1>
        <p class="text-sm text-secondary mt-1">内容管理与状态总览</p>
      </div>
      <div class="flex items-center gap-3">
        <button v-if="isProjectPM" class="btn-secondary text-sm" @click="showCategoryDialog = true">
          <span class="i-lucide-tag w-4 h-4 inline-block align-middle mr-1" />分类管理
        </button>
        <button v-if="isProjectPM" class="btn-secondary text-sm" @click="openCreateDialog">
          <span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />新建内容
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-6 pb-6">
      <LoadingState v-if="loading" />
      <template v-else>
        <div v-for="(items, catId) in groupedFeatures" :key="catId" class="mb-8">
          <h2 class="text-sm font-semibold text-muted uppercase mb-3 flex items-center gap-2">
            <span
              v-if="catId !== '__uncategorized__' && categoryInfo.has(catId)"
              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
              :style="{ backgroundColor: categoryInfo.get(catId)!.color }"
            />
            <span v-if="catId === '__uncategorized__'" class="text-muted">未分类</span>
            <span v-else>{{ categoryInfo.get(catId)?.name || catId }}</span>
          </h2>
          <div class="card divide-y divide-default p-0 overflow-hidden">
            <template v-for="f in items" :key="f.id">
              <div
                class="flex items-center gap-3 px-6 py-4 hover:bg-hover transition-colors group"
                :class="expandedFeatureId === f.id ? 'bg-active/50' : ''"
                :style="
                  catId !== '__uncategorized__'
                    ? { borderLeft: `3px solid ${categoryInfo.get(catId)?.color || 'transparent'}` }
                    : {}
                "
              >
                <!-- 展开按钮 -->
                <button
                  class="text-muted hover:text-secondary flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors"
                  @click.stop="() => toggleExpand(f.id)"
                >
                  <span
                    class="i-lucide-chevron-right w-4 h-4 inline-block align-middle transition-transform duration-200"
                    :class="{ 'rotate-90': expandedFeatureId === f.id }"
                  />
                </button>
                <div class="flex-1 min-w-0 cursor-pointer" @click="() => openEditor(f.id)">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-primary">{{ f.title }}</span>
                    <span class="text-xs text-muted font-mono">{{ f.id }}</span>
                    <span
                      v-if="f.orphanedCount > 0"
                      v-tooltip="`${f.orphanedCount} 个游离文档`"
                      class="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                      ><span class="i-lucide-alert-triangle w-3 h-3 inline-block align-middle" />{{
                        f.orphanedCount
                      }}</span
                    >
                  </div>
                  <p class="text-sm text-secondary mt-0.5 truncate">
                    {{ f.description }}
                  </p>
                </div>
                <div class="flex items-center gap-4 text-sm flex-shrink-0">
                  <span class="text-xs text-muted"
                    >{{ f.approvedSections ?? 0 }}/{{ f.totalSections ?? 0 }} 已审核</span
                  >
                  <StatusBadge :status="getOverallStatus(f)" variant="badge" />
                  <button
                    v-if="isProjectPM"
                    class="text-blue-400 hover:color-accent text-sm"
                    @click.stop="() => openEditDialog(f.id)"
                  >
                    设置
                  </button>
                  <button
                    v-if="isProjectPM"
                    class="text-red-400 hover:color-danger text-sm"
                    @click.stop="() => deleteCustomFeature(f.id)"
                  >
                    <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
                  </button>
                </div>
              </div>
              <!-- 展开的小节列表 -->
              <div
                v-if="expandedFeatureId === f.id"
                class="bg-base px-10 py-3 border-t border-light"
              >
                <div class="text-xs text-muted mb-2 flex items-center gap-2">
                  <span>小节</span>
                  <span
                    v-if="isProjectPM && parseSections(f.sections).length > 1"
                    class="text-muted/50"
                    >— 拖拽调整顺序</span
                  >
                </div>
                <div
                  class="space-y-1"
                  :data-section-sort="f.id"
                  :ref="
                    (el: any) => {
                      if (el && expandedFeatureId === f.id) initSectionSort(f.id, el as HTMLElement)
                    }
                  "
                >
                  <div
                    v-for="(sec, i) in parseSections(f.sections)"
                    :key="sec.key"
                    class="flex items-center gap-3 text-sm py-1.5 px-3 rounded hover:bg-surface cursor-pointer transition-colors group"
                    @click="() => openEditor(f.id)"
                  >
                    <div
                      v-if="isProjectPM"
                      class="drag-handle cursor-grab text-muted hover:text-secondary flex-shrink-0"
                    >
                      <span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" />
                    </div>
                    <span class="text-secondary flex-1 truncate">{{ sec.title }}</span>
                    <button
                      v-if="isProjectPM"
                      class="text-red-400 hover:color-danger text-xs p-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      @click.stop="() => removeSectionInline(f.id, i)"
                    >
                      <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
                    </button>
                  </div>
                  <!-- 无显式小节，有 _default 文档 -->
                  <div
                    v-if="parseSections(f.sections).length === 0 && f.totalSections > 0"
                    class="flex items-center gap-3 text-sm py-1.5 px-3 rounded hover:bg-surface cursor-pointer transition-colors"
                    @click="() => openEditor(f.id)"
                  >
                    <span class="text-secondary">正文</span>
                    <span class="text-xs text-muted">默认小节</span>
                  </div>
                  <!-- 无显式小节，无文档 -->
                  <div
                    v-if="parseSections(f.sections).length === 0 && f.totalSections === 0"
                    class="text-xs text-muted py-2"
                  >
                    <template v-if="isProjectPM">暂无小节，在上方输入框中添加</template>
                    <template v-else>暂无小节</template>
                  </div>
                  <!-- 添加小节（PM only） -->
                  <div v-if="isProjectPM" class="flex items-center gap-2 pt-1">
                    <input
                      :value="getSectionAddInput(f.id)"
                      class="input text-sm flex-1 !py-1"
                      placeholder="新增小节标题"
                      @input="(e: any) => setSectionAddInput(f.id, e.target.value)"
                      @keyup.enter="addSectionInline(f.id)"
                    />
                    <button
                      class="btn-secondary text-sm flex-shrink-0 !py-1"
                      :disabled="!getSectionAddInput(f.id)?.trim()"
                      @click="addSectionInline(f.id)"
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
        <EmptyState
          v-if="features.length === 0"
          icon="i-lucide-clipboard-list"
          :title="currentProjectId ? '暂无内容' : '未选择项目'"
          :description="
            currentProjectId
              ? isProjectPM
                ? '点击「新建内容」创建第一个内容'
                : '当前项目暂无内容'
              : '请先加入项目，或联系管理员'
          "
        />
      </template>
    </div>

    <!-- 新建/编辑内容 -->
    <div
      v-if="showFeatureDialog"
      class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
    >
      <div
        class="bg-surface rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div
          class="px-6 py-4 border-b border-default flex items-center justify-between flex-shrink-0"
        >
          <h2 class="text-lg font-semibold">
            {{ featureDialogMode === 'create' ? '新建内容' : '内容设置' }}
          </h2>
          <button
            class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover"
            @click="showFeatureDialog = false"
          >
            <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
          </button>
        </div>
        <div class="p-6 overflow-y-auto flex-1">
          <ErrorMessage :message="featureFormError" class="mb-4" />
          <div class="space-y-4">
            <FormField label="内容名称" :required="true">
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
            <FormField label="内容描述">
              <textarea
                v-model="featureForm.description"
                class="textarea"
                rows="2"
                placeholder="简要描述内容用途"
              />
            </FormField>
            <!-- 新建时可选择是否创建默认小节 -->
            <CheckboxField
              v-if="featureDialogMode === 'create'"
              v-model="featureForm.createDefaultSection"
              label="创建默认小节（正文）"
              description="勾选后可立即在正文中编写内容；后续添加小节时正文将变为游离文档"
            />
            <p v-else class="text-xs text-muted">小节可在展开列表中添加、拖拽排序</p>
          </div>
        </div>
        <div class="px-6 py-4 border-t border-default flex justify-end gap-3 flex-shrink-0">
          <button type="button" class="btn-secondary" @click="showFeatureDialog = false">
            取消
          </button>
          <button type="button" class="btn-primary" @click="saveFeature">
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
      <div class="bg-surface rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div
          class="px-6 py-4 border-b border-default flex items-center justify-between flex-shrink-0"
        >
          <h2 class="text-lg font-semibold">分类管理</h2>
          <button
            class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover"
            @click="showCategoryDialog = false"
          >
            <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
          </button>
        </div>
        <div class="p-6 overflow-y-auto">
          <ErrorMessage :message="categoryError" class="mb-4" />
          <div class="flex items-end gap-2 pb-4 border-b border-light">
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
              class="flex items-center gap-3 py-2.5 px-2 rounded hover:bg-hover transition-colors"
            >
              <div
                class="cat-drag-handle cursor-grab text-muted hover:text-secondary flex-shrink-0"
              >
                <span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" />
              </div>
              <span
                class="w-3.5 h-3.5 rounded-full flex-shrink-0"
                :style="{ backgroundColor: c.color }"
              />
              <div
                v-if="editingCategory?.id !== c.id"
                class="flex-1 flex items-center gap-2 min-w-0"
              >
                <span class="font-medium text-sm truncate">{{ c.name }}</span>
                <span class="text-xs text-muted flex-shrink-0"
                  >{{ categoryFeatureCount.get(c.id) || 0 }} 个内容</span
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
                    class="text-muted hover:text-secondary text-sm"
                    @click="editingCategory = null"
                  >
                    取消
                  </button>
                </template>
                <template v-else>
                  <button
                    class="text-blue-400 hover:color-accent text-sm"
                    @click="() => openEditCategory(c)"
                  >
                    编辑
                  </button>
                  <button
                    class="text-red-400 hover:color-danger text-sm"
                    @click="() => deleteCategory(c.id)"
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
          <p v-if="categories.length > 1" class="text-xs text-muted mt-3">
            拖拽
            <span class="i-lucide-grip-vertical w-3 h-3 inline-block align-middle" />
            图标可调整分类排序
          </p>
        </div>
        <div class="px-6 py-4 border-t border-default flex justify-end flex-shrink-0">
          <button class="btn-secondary" @click="showCategoryDialog = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
