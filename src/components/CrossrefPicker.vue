<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useProject } from '@/composables/useProject'
import { getFeatures } from '@/api/endpoints/features'
import { getCategories } from '@/api/endpoints/categories'
import type { FeatureSummary, CategoryInfo, SectionDef } from '@shared/types'
import ModalDialog from './ModalDialog.vue'

const emit = defineEmits<{
  close: []
  select: [payload: { featureId: string; label: string; sectionKey: string; sectionTitle: string }]
  remove: []
}>()

const props = defineProps<{
  visible: boolean
  currentFeatureId?: string
  currentSectionKey?: string
}>()

const { currentProjectId } = useProject()

const features = ref<FeatureSummary[]>([])
const categories = ref<CategoryInfo[]>([])
const searchQuery = ref('')
const selectedFeatureId = ref<string | null>(null)
const selectedSectionKey = ref<string | null>(null)
const expandedFeatureId = ref<string | null>(null)
const customLabel = ref('')
const loading = ref(false)
const error = ref('')

const categoryMap = computed(() => {
  const map = new Map<string, string>()
  for (const c of categories.value) {
    map.set(c.id, c.name)
  }
  return map
})

const moduleGroups = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const filtered = q
    ? features.value.filter((f) => {
        const catName = f.categoryId ? categoryMap.value.get(f.categoryId) || '' : ''
        return (
          f.title.toLowerCase().includes(q) ||
          catName.toLowerCase().includes(q) ||
          f.sections.some((s) => s.title.toLowerCase().includes(q))
        )
      })
    : features.value

  const groups: Record<string, FeatureSummary[]> = {}
  for (const f of filtered) {
    const mod = f.categoryId ? categoryMap.value.get(f.categoryId) || '未分类' : '未分类'
    if (!groups[mod]) groups[mod] = []
    groups[mod].push(f)
  }
  return groups
})

const selectedLabel = computed(() => {
  if (!selectedFeatureId.value) return ''
  const f = features.value.find((f) => f.id === selectedFeatureId.value)
  if (!f) return ''
  if (selectedSectionKey.value) {
    const sec = f.sections.find((s) => s.key === selectedSectionKey.value)
    return sec ? `${f.title} › ${sec.title}` : f.title
  }
  return f.title
})

async function loadData() {
  if (!currentProjectId.value) return
  loading.value = true
  error.value = ''
  try {
    const [featList, catList] = await Promise.all([
      getFeatures(currentProjectId.value),
      getCategories(currentProjectId.value),
    ])
    features.value = featList.map((f) => ({
      ...f,
      // sections 在 API 返回中是 JSON 字符串，需要解析
      sections:
        typeof f.sections === 'string' ? (JSON.parse(f.sections) as SectionDef[]) : f.sections,
    }))
    categories.value = catList
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function toggleFeature(id: string) {
  if (expandedFeatureId.value === id) {
    expandedFeatureId.value = null
  } else {
    expandedFeatureId.value = id
  }
  selectedFeatureId.value = id
  selectedSectionKey.value = null
}

function selectSection(featureId: string, sectionKey: string) {
  selectedFeatureId.value = featureId
  selectedSectionKey.value = sectionKey
}

function confirm() {
  if (!selectedFeatureId.value) return
  const f = features.value.find((f) => f.id === selectedFeatureId.value)
  if (!f) return

  const label = customLabel.value.trim() || selectedLabel.value

  if (selectedSectionKey.value) {
    const sec = f.sections.find((s) => s.key === selectedSectionKey.value)
    if (sec) {
      emit('select', { featureId: f.id, label, sectionKey: sec.key, sectionTitle: sec.title })
      return
    }
  }
  emit('select', { featureId: f.id, label, sectionKey: '', sectionTitle: '' })
}

watch(selectedLabel, (val) => {
  if (val) customLabel.value = val
})

function removeRef() {
  emit('remove')
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      selectedFeatureId.value = props.currentFeatureId || null
      selectedSectionKey.value = props.currentSectionKey || null
      expandedFeatureId.value = props.currentFeatureId || null
      customLabel.value = ''
      if (features.value.length === 0) loadData()
    }
  },
)

watch(currentProjectId, () => {
  if (props.visible) loadData()
})
</script>

<template>
  <ModalDialog
    :visible="visible"
    title="插入交叉引用"
    hide-footer
    width-class="max-w-xl"
    @close="() => emit('close')"
  >
    <!-- 搜索 -->
    <div class="mb-3">
      <input
        v-model="searchQuery"
        type="text"
        class="input"
        placeholder="搜索内容名称、分类或小节..."
      />
    </div>

    <!-- 列表 -->
    <div class="max-h-[40vh] overflow-y-auto -mx-6 px-6">
      <div v-if="loading" class="text-center text-muted py-8 text-sm">加载中...</div>
      <div v-else-if="error" class="text-center color-danger py-8 text-sm">
        {{ error }}
      </div>
      <div
        v-else-if="Object.keys(moduleGroups).length === 0"
        class="text-center text-muted py-8 text-sm"
      >
        <template v-if="searchQuery"> 无匹配的内容 </template>
        <template v-else> 当前项目暂无内容 </template>
      </div>

      <template v-else>
        <div v-for="(items, mod) in moduleGroups" :key="mod" class="mb-4">
          <div class="text-xs text-muted font-medium mb-2 px-1">
            {{ mod }}
          </div>

          <div v-for="f in items" :key="f.id" class="mb-1">
            <div
              class="px-3 py-2 rounded-lg cursor-pointer transition-colors border flex items-center gap-2"
              :class="
                selectedFeatureId === f.id && !selectedSectionKey
                  ? 'bg-active border-[var(--c-accent)]/30 color-accent'
                  : 'border-light hover:bg-hover text-secondary'
              "
              @click="() => toggleFeature(f.id)"
            >
              <span
                v-if="f.sections.length > 0"
                class="i-lucide-chevron-right w-3.5 h-3.5 inline-block align-middle flex-shrink-0 transition-transform duration-200 text-muted"
                :class="{ 'rotate-90': expandedFeatureId === f.id }"
              />
              <span v-else class="w-3.5 flex-shrink-0" />
              <span class="text-sm font-medium flex-1">{{ f.title }}</span>
              <span v-if="f.sections.length > 0" class="text-xs text-muted">
                {{ f.sections.length }} 小节
              </span>
            </div>

            <div
              v-if="expandedFeatureId === f.id && f.sections.length > 0"
              class="ml-7 mt-1 border-l-2 border-light pl-4 space-y-0.5"
            >
              <div
                v-for="sec in f.sections"
                :key="sec.key"
                class="px-2.5 py-1.5 rounded-md cursor-pointer transition-colors text-sm"
                :class="
                  selectedSectionKey === sec.key
                    ? 'bg-active color-accent font-medium'
                    : 'text-secondary hover:bg-hover'
                "
                @click.stop="() => selectSection(f.id, sec.key)"
              >
                {{ sec.title }}
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 底部操作栏 -->
    <div class="flex items-center justify-between pt-3 mt-3 border-t border-default">
      <button v-if="currentFeatureId" type="button" class="btn-danger text-sm" @click="removeRef">
        移除引用
      </button>
      <div v-else />

      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-xs text-secondary whitespace-nowrap">显示名称</label>
          <input
            v-model="customLabel"
            type="text"
            class="w-36 px-2 py-1.5 text-sm bg-surface text-primary placeholder:text-muted border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
            placeholder="引用显示文字"
          />
        </div>
        <button type="button" class="btn-secondary text-sm" @click="() => emit('close')">
          取消
        </button>
        <button
          type="button"
          class="btn-primary text-sm"
          :disabled="!selectedFeatureId"
          @click="confirm"
        >
          插入引用
        </button>
      </div>
    </div>
  </ModalDialog>
</template>
