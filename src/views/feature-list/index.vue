<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { useDialog } from '@/composables/useDialog'
import Sortable from 'sortablejs'
import ModalDialog from '@/components/ModalDialog.vue'
import FormField from '@/components/FormField.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import SelectDropdown from '@/components/SelectDropdown.vue'
import ColorPicker from '@/components/ColorPicker.vue'
import { getFeatures, createFeature, updateFeature, deleteFeature, getFeature, importFeatures, applyImport } from '@/api/endpoints/features'
import { getCategories, createCategory as apiCreateCategory, updateCategory, deleteCategory as apiDeleteCategory } from '@/api/endpoints/categories'
import type { FeatureSummary, CategoryInfo, ImportDiffResponse, ImportFeatureItem, SectionDef } from '@shared/types'

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
const { isPM } = useAuth()
const { currentProjectId } = useProject()
const { confirm, dangerConfirm } = useDialog()
const features = ref<FeatureRow[]>([])
const loading = ref(true)
const expandedFeatureId = ref<string | null>(null)

function parseSections(sections: string | SectionDef[]): SectionDef[] {
  if (Array.isArray(sections)) return sections
  try { return JSON.parse(sections || '[]') } catch { return [] }
}

function toggleExpand(featureId: string) {
  expandedFeatureId.value = expandedFeatureId.value === featureId ? null : featureId
}
const showImportDialog = ref(false)
const importFile = ref<File | null>(null)
const importDiff = ref<any>(null)
const importError = ref('')
const importing = ref(false)
const showCreateDialog = ref(false)
const createError = ref('')
const newFeature = ref({ title: '', description: '', categoryId: null as string | null, sections: [] as SectionDef[] })
const newSectionTitle = ref('')
const createSectionSortEl = ref<HTMLElement>()

function generateKey(): string { return crypto.randomUUID().slice(0, 8) }

function addNewSection() {
  const title = newSectionTitle.value.trim()
  if (!title) { createError.value = '请输入章节标题'; return }
  createError.value = ''
  newFeature.value.sections.push({ key: generateKey(), title })
  newSectionTitle.value = ''
}

function removeNewSection(index: number) { newFeature.value.sections.splice(index, 1) }

// 分类管理
const categories = ref<CategoryItem[]>([])
const showCategoryDialog = ref(false)
const categoryError = ref('')
const newCategory = ref({ name: '', color: '#6366f1' })
const editingCategory = ref<CategoryItem | null>(null)
const editCategoryForm = ref({ name: '', color: '#6366f1', sortOrder: 0 })

async function loadCategories() {
  try {
    categories.value = await getCategories(currentProjectId.value ?? undefined) as unknown as CategoryItem[]
  } catch { /* ignore */ }
}

async function createCategory() {
  categoryError.value = ''
  if (!newCategory.value.name.trim()) { categoryError.value = '请输入分类名称'; return }
  try {
    await apiCreateCategory({
      name: newCategory.value.name,
      color: newCategory.value.color,
      projectId: currentProjectId.value ?? undefined,
    })
    newCategory.value = { name: '', color: '#6366f1' }
    await loadCategories()
  } catch (e: unknown) { categoryError.value = e instanceof Error ? e.message : '网络错误' }
}

function openEditCategory(c: CategoryItem) {
  editingCategory.value = c
  editCategoryForm.value = { name: c.name, color: c.color, sortOrder: c.sortOrder }
}

async function saveEditCategory() {
  if (!editingCategory.value) return
  categoryError.value = ''
  if (!editCategoryForm.value.name.trim()) { categoryError.value = '请输入分类名称'; return }
  try {
    await updateCategory(editingCategory.value.id, {
      name: editCategoryForm.value.name,
      color: editCategoryForm.value.color,
      sortOrder: editCategoryForm.value.sortOrder,
    })
    editingCategory.value = null
    await loadCategories()
  } catch (e: unknown) { categoryError.value = e instanceof Error ? e.message : '网络错误' }
}

async function deleteCategory(id: string) {
  if (!await dangerConfirm('确定删除此分类？已归类的主题将变为"未分类"。')) return
  await apiDeleteCategory(id)
  await loadCategories()
}

// 编辑自定义主题
const showEditDialog = ref(false)
const editError = ref('')
const editingFeature = ref<{ id: string; title: string; description: string; categoryId: string | null; sections: SectionDef[] } | null>(null)
const editSectionTitle = ref('')
const editSectionSortEl = ref<HTMLElement>()
function generateEditKey(): string { return crypto.randomUUID().slice(0, 8) }

async function openEditDialog(featureId: string) {
  try {
    const data = await getFeature(featureId)
    editingFeature.value = {
      id: data.id, title: data.title, description: data.description,
      categoryId: data.categoryId || null,
      sections: data.sections.map(s => ({ key: s.key, title: s.title })),
    }
    editSectionTitle.value = ''
    showEditDialog.value = true
    await nextTick()
    initEditSectionSort()
  } catch (e) { console.error('Failed to load feature:', e) }
}

function addEditSection() {
  const title = editSectionTitle.value.trim()
  if (!title || !editingFeature.value) { editError.value = '请输入章节标题'; return }
  editError.value = ''
  editingFeature.value.sections.push({ key: generateEditKey(), title })
  editSectionTitle.value = ''
}

function removeEditSection(index: number) {
  if (!editingFeature.value) return
  editingFeature.value.sections.splice(index, 1)
}

async function saveEditFeature() {
  editError.value = ''
  if (!editingFeature.value || !editingFeature.value.title.trim()) { editError.value = '请输入主题名称'; return }
  if (editingFeature.value.sections.length === 0) { editError.value = '至少需要一个章节'; return }
  try {
    await updateFeature(editingFeature.value.id, {
      title: editingFeature.value.title,
      description: editingFeature.value.description,
      sections: editingFeature.value.sections,
      categoryId: editingFeature.value.categoryId ?? undefined,
    })
    showEditDialog.value = false
    editingFeature.value = null
    await loadFeatures()
  } catch (e: unknown) { editError.value = e instanceof Error ? e.message : '网络错误，保存失败' }
}

function initEditSectionSort() {
  if (!editSectionSortEl.value) return
  Sortable.create(editSectionSortEl.value, {
    animation: 200, handle: '.drag-handle', ghostClass: 'bg-blue-50',
    onEnd(evt) {
      if (evt.oldIndex !== undefined && evt.newIndex !== undefined && editingFeature.value) {
        const items = editingFeature.value.sections
        const [moved] = items.splice(evt.oldIndex, 1)
        items.splice(evt.newIndex, 0, moved)
      }
    },
  })
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
  } finally { loading.value = false }
}

async function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  importFile.value = target.files?.[0] || null
}

async function handleImport() {
  if (!importFile.value) return
  importing.value = true; importError.value = ''
  try {
    const text = await importFile.value.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { importError.value = 'JSON 格式错误，请检查文件内容'; return }
    importDiff.value = await importFeatures(currentProjectId.value ?? undefined, { features: data as ImportFeatureItem[] })
  } finally { importing.value = false }
}

async function confirmImport() {
  if (!importDiff.value) return
  importing.value = true; importError.value = ''
  try {
    const diff = importDiff.value as ImportDiffResponse
    const featuresToApply = [...diff.added, ...diff.modified.map(m => m.after)]
    await applyImport(currentProjectId.value ?? undefined, {
      features: featuresToApply,
      removeIds: diff.removed.map(r => r.id as string),
    })
    importDiff.value = null
    showImportDialog.value = false
    importFile.value = null
    await loadFeatures()
  } finally { importing.value = false }
}

async function createCustomFeature() {
  createError.value = ''
  if (!newFeature.value.title.trim()) { createError.value = '请输入主题名称'; return }
  if (newFeature.value.sections.length === 0) { createError.value = '至少需要一个章节'; return }
  try {
    await createFeature({
      title: newFeature.value.title,
      description: newFeature.value.description,
      sections: newFeature.value.sections,
      categoryId: newFeature.value.categoryId ?? undefined,
      projectId: currentProjectId.value ?? undefined,
    })
    showCreateDialog.value = false
    newFeature.value = { title: '', description: '', categoryId: null, sections: [] }
    await loadFeatures()
  } catch (e: unknown) { createError.value = e instanceof Error ? e.message : '网络错误，创建失败' }
}

watch(showCreateDialog, async (val) => {
  if (val) {
    await nextTick()
    if (createSectionSortEl.value) {
      Sortable.create(createSectionSortEl.value, {
        animation: 200, handle: '.drag-handle', ghostClass: 'bg-blue-50',
        onEnd(evt) {
          if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
            const items = newFeature.value.sections
            const [moved] = items.splice(evt.oldIndex, 1)
            items.splice(evt.newIndex, 0, moved)
          }
        },
      })
    }
  }
})

async function deleteCustomFeature(id: string) {
  const f = features.value.find(f => f.id === id)
  const msg = f
    ? `确定删除「${f.title}」？\n${f.totalSections} 个章节文档将被一并删除，不可恢复。`
    : '确定删除此主题？'
  if (!await dangerConfirm(msg)) return
  await deleteFeature(id)
  await loadFeatures()
}

function openEditor(id: string) { router.push(`/features/${id}/edit`) }

onMounted(loadFeatures)
watch(currentProjectId, loadFeatures)
</script>

<template>
  <div class="h-full flex flex-col max-w-6xl mx-auto">
    <div class="flex-shrink-0 flex items-center justify-between mb-6 px-6 pt-6">
      <div>
        <h1 class="text-2xl font-bold">主题列表</h1>
        <p class="text-sm text-gray-500 mt-1">主题骨架管理与状态总览</p>
      </div>
      <div class="flex items-center gap-3">
        <button v-if="isPM" class="btn-secondary text-sm" @click="showCategoryDialog = true"><span class="i-lucide-tag w-4 h-4 inline-block align-middle mr-1" />分类管理</button>
        <button v-if="isPM" class="btn-secondary text-sm" @click="showCreateDialog = true"><span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />自定义主题</button>
        <button v-if="isPM" class="btn-primary text-sm" @click="showImportDialog = true"><span class="i-lucide-upload w-4 h-4 inline-block align-middle mr-1" />导入骨架</button>
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
                :style="catId !== '__uncategorized__' ? { borderLeft: `3px solid ${categoryInfo.get(catId)?.color || 'transparent'}` } : {}"
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
                    <span v-if="f.orphanedCount > 0" class="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" :title="`${f.orphanedCount} 个游离文档`"><span class="i-lucide-alert-triangle w-3 h-3 inline-block align-middle" />{{ f.orphanedCount }}</span>
                  </div>
                  <p class="text-sm text-gray-500 mt-0.5 truncate">{{ f.description }}</p>
                </div>
                <div class="flex items-center gap-4 text-sm flex-shrink-0">
                  <span class="text-xs text-gray-400">{{ f.approvedSections }}/{{ f.totalSections || 1 }} 已审核</span>
                  <StatusBadge :status="getOverallStatus(f)" variant="badge" />
                  <button v-if="isPM" class="text-blue-400 hover:text-blue-600 text-sm" @click.stop="openEditDialog(f.id)">编辑</button>
                  <button v-if="isPM" class="text-red-400 hover:text-red-600 text-sm" @click.stop="deleteCustomFeature(f.id)"><span class="i-lucide-x w-4 h-4 inline-block align-middle" /></button>
                </div>
              </div>
              <!-- 展开的章节列表 -->
              <div
                v-if="expandedFeatureId === f.id"
                class="bg-gray-50 px-10 py-3 border-t border-gray-100"
              >
                <div class="text-xs text-gray-400 mb-2">主题章节</div>
                <div class="space-y-1">
                  <div
                    v-for="sec in parseSections(f.sections)"
                    :key="sec.key"
                    class="flex items-center gap-3 text-sm py-1.5 px-3 rounded hover:bg-white cursor-pointer transition-colors"
                    @click="openEditor(f.id)"
                  >
                    <span class="text-gray-700 flex-1">{{ sec.title }}</span>
                    <span class="text-xs text-gray-400 font-mono">{{ sec.key }}</span>
                  </div>
                  <div v-if="parseSections(f.sections).length === 0" class="text-xs text-gray-400 py-2">暂无章节</div>
                </div>
              </div>
            </template>
          </div>
        </div>
        <EmptyState v-if="features.length === 0" icon="i-lucide-clipboard-list" title="暂无主题骨架" description="点击「导入骨架」上传 features.json 或创建自定义主题" />
      </template>
    </div>

    <!-- 导入对话框 -->
    <div v-if="showImportDialog" class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 class="text-lg font-semibold">导入主题骨架</h2>
          <button class="text-gray-400 hover:text-gray-600 p-1" @click="showImportDialog = false"><span class="i-lucide-x w-5 h-5 inline-block align-middle" /></button>
        </div>
        <div class="p-6 overflow-y-auto flex-1">
          <div v-if="!importDiff">
            <FormField label="选择 features.json 文件">
              <input type="file" accept=".json" class="input" @change="handleFileSelect" />
            </FormField>
            <button class="btn-primary mt-4" :disabled="!importFile || importing" @click="handleImport">
              {{ importing ? '分析中...' : '分析差异' }}
            </button>
            <ErrorMessage :message="importError" class="mt-3" />
          </div>
          <div v-else>
            <div class="space-y-4">
              <div v-if="importDiff.added.length > 0">
                <h3 class="text-sm font-semibold text-green-600 mb-2">新增 ({{ importDiff.added.length }})</h3>
                <div v-for="f in importDiff.added" :key="f.id" class="text-sm text-gray-600 pl-3 border-l-2 border-green-300 py-1 mb-1">
                  <span class="font-medium">{{ f.title }}</span>
                  <span class="text-xs text-gray-400 ml-2">{{ f.id }}</span>
                </div>
              </div>
              <div v-if="importDiff.modified.length > 0">
                <h3 class="text-sm font-semibold text-blue-600 mb-2">已修改 ({{ importDiff.modified.length }})</h3>
                <div v-for="m in importDiff.modified" :key="m.after.id" class="text-sm text-gray-600 pl-3 border-l-2 border-blue-300 py-1 mb-1">
                  <span class="font-medium">{{ m.after.title }}</span>
                  <span class="text-xs text-blue-500 ml-2">变更: {{ m.changes.join(', ') }}</span>
                </div>
              </div>
              <div v-if="importDiff.removed.length > 0">
                <h3 class="text-sm font-semibold text-red-600 mb-2">缺失 ({{ importDiff.removed.length }})</h3>
                <div v-for="f in importDiff.removed" :key="f.id" class="text-sm text-gray-600 pl-3 border-l-2 border-red-300 py-1 mb-1">
                  <span class="font-medium">{{ f.title }}</span>
                  <span class="text-xs text-red-400 ml-2">{{ f.id }}</span>
                  <span v-if="f.has_content" class="text-xs text-orange-500 ml-2">(有内容)</span>
                </div>
              </div>
              <div v-if="importDiff.added.length === 0 && importDiff.modified.length === 0 && importDiff.removed.length === 0" class="text-center text-gray-400 py-8">没有差异，数据已是最新</div>
            </div>
          </div>
        </div>
        <div v-if="importDiff" class="px-6 py-4 border-t border-gray-200 flex flex-col gap-3">
          <ErrorMessage :message="importError" />
          <div class="flex justify-end gap-3">
            <button class="btn-secondary" @click="importDiff = null">返回</button>
            <button class="btn-primary" :disabled="importing" @click="confirmImport">{{ importing ? '导入中...' : '确认导入' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建自定义主题 -->
    <ModalDialog :visible="showCreateDialog" title="新建自定义主题" confirm-text="创建" cancel-text="取消" :error="createError" @close="showCreateDialog = false" @confirm="createCustomFeature">
      <div class="space-y-4">
        <FormField label="主题名称" :required="true">
          <input v-model="newFeature.title" class="input" placeholder="如：常见问题" />
        </FormField>
        <FormField label="所属分类">
          <SelectDropdown
            v-model="newFeature.categoryId"
            :options="[
              { value: null, label: '未分类' },
              ...categories.map(c => ({ value: c.id, label: c.name }))
            ]"
          />
        </FormField>
        <FormField label="主题描述">
          <textarea v-model="newFeature.description" class="textarea" rows="2" placeholder="简要描述主题用途" />
        </FormField>
        <div>
          <label class="label">章节 <span class="text-red-400">*</span></label>
          <div v-if="newFeature.sections.length > 0" ref="createSectionSortEl" class="mb-3 space-y-1">
            <div v-for="(s, i) in newFeature.sections" :key="s.key" class="flex items-center gap-2 text-sm bg-gray-50 px-3 py-1.5 rounded">
              <div class="drag-handle cursor-grab text-gray-300 hover:text-gray-500"><span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" /></div>
              <span class="text-gray-400 font-mono text-xs">{{ s.key }}</span>
              <span class="flex-1 text-gray-700">{{ s.title }}</span>
              <button class="text-red-400 hover:text-red-600 text-xs p-1" @click="removeNewSection(i)"><span class="i-lucide-x w-4 h-4 inline-block align-middle" /></button>
            </div>
          </div>
          <div class="flex gap-2">
            <input v-model="newSectionTitle" class="input flex-1" placeholder="章节标题" @keyup.enter="addNewSection" />
            <button class="btn-secondary text-sm flex-shrink-0" @click="addNewSection">添加</button>
          </div>
          <p class="text-xs text-gray-400 mt-1">至少需要一个章节，key 自动生成</p>
        </div>
      </div>
    </ModalDialog>

    <!-- 编辑自定义主题 -->
    <ModalDialog :visible="showEditDialog && editingFeature !== null" title="编辑主题" confirm-text="保存" cancel-text="取消" :error="editError" @close="showEditDialog = false" @confirm="saveEditFeature">
      <div v-if="editingFeature" class="space-y-4">
        <FormField label="主题名称" :required="true">
          <input v-model="editingFeature.title" class="input" placeholder="如：常见问题" />
        </FormField>
        <FormField label="所属分类">
          <SelectDropdown
            v-model="editingFeature.categoryId"
            :options="[
              { value: null, label: '未分类' },
              ...categories.map(c => ({ value: c.id, label: c.name }))
            ]"
          />
        </FormField>
        <FormField label="主题描述">
          <textarea v-model="editingFeature.description" class="textarea" rows="2" placeholder="简要描述主题用途" />
        </FormField>
        <div>
          <label class="label">章节 <span class="text-red-400">*</span></label>
          <div v-if="editingFeature.sections.length > 0" ref="editSectionSortEl" class="mb-3 space-y-1">
            <div v-for="(s, i) in editingFeature.sections" :key="s.key" class="flex items-center gap-2 text-sm bg-gray-50 px-3 py-1.5 rounded">
              <div class="drag-handle cursor-grab text-gray-300 hover:text-gray-500"><span class="i-lucide-grip-vertical w-4 h-4 inline-block align-middle" /></div>
              <span class="text-gray-400 font-mono text-xs">{{ s.key }}</span>
              <span class="flex-1 text-gray-700">{{ s.title }}</span>
              <button class="text-red-400 hover:text-red-600 text-xs p-1" @click="removeEditSection(i)"><span class="i-lucide-x w-4 h-4 inline-block align-middle" /></button>
            </div>
          </div>
          <div class="flex gap-2">
            <input v-model="editSectionTitle" class="input flex-1" placeholder="章节标题" @keyup.enter="addEditSection" />
            <button class="btn-secondary text-sm flex-shrink-0" @click="addEditSection">添加</button>
          </div>
          <p class="text-xs text-gray-400 mt-1">至少需要一个章节，key 自动生成</p>
        </div>
      </div>
    </ModalDialog>

    <!-- 分类管理 -->
    <ModalDialog
      :visible="showCategoryDialog"
      title="分类管理"
      confirm-text=""
      cancel-text="关闭"
      :error="categoryError"
      @close="showCategoryDialog = false"
      @confirm="showCategoryDialog = false"
    >
      <div class="space-y-4">
        <div class="flex items-end gap-2 pb-4 border-b border-gray-100">
          <FormField label="分类名称" class="flex-1">
            <input v-model="newCategory.name" class="input" placeholder="如：系统管理" />
          </FormField>
          <FormField label="颜色">
            <ColorPicker v-model="newCategory.color" />
          </FormField>
          <div>
            <label class="label invisible">-</label>
            <button class="btn-primary text-sm h-[42px]" @click="createCategory">添加</button>
          </div>
        </div>

        <div v-for="c in categories" :key="c.id"
          class="flex items-center gap-3 py-2 border-b border-gray-50">
          <span class="w-4 h-4 rounded-full flex-shrink-0" :style="{ backgroundColor: c.color }"></span>
          <div v-if="editingCategory?.id !== c.id" class="flex-1 flex items-center gap-2">
            <span class="font-medium text-sm">{{ c.name }}</span>
            <span class="text-xs text-gray-400">排序: {{ c.sortOrder }}</span>
          </div>
          <div v-else class="flex-1 flex items-center gap-2">
            <input v-model="editCategoryForm.name" class="input text-sm flex-1" />
            <ColorPicker v-model="editCategoryForm.color" class="flex-shrink-0" />
            <input v-model.number="editCategoryForm.sortOrder" type="number" class="input text-sm w-16" />
          </div>
          <div class="flex items-center gap-2">
            <template v-if="editingCategory?.id === c.id">
              <button class="text-green-500 hover:text-green-700 text-sm" @click="saveEditCategory">保存</button>
              <button class="text-gray-400 hover:text-gray-600 text-sm" @click="editingCategory = null">取消</button>
            </template>
            <template v-else>
              <button class="text-blue-400 hover:text-blue-600 text-sm" @click="openEditCategory(c)">编辑</button>
              <button class="text-red-400 hover:text-red-600 text-sm" @click="deleteCategory(c.id)"><span class="i-lucide-x w-4 h-4 inline-block align-middle" /></button>
            </template>
          </div>
        </div>
        <EmptyState v-if="categories.length === 0" title="暂无分类" description="点击上方添加按钮创建第一个分类" />
      </div>
    </ModalDialog>
  </div>
</template>
