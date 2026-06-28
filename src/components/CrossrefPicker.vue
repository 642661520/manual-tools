<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useProject } from '@/composables/useProject'
import { getFeatures } from '@/api/endpoints/features'
import ModalDialog from './ModalDialog.vue'

// API 返回的原始特征数据（sections 为 JSON 字符串）
interface FeatureApiEntry {
  id: string
  title: string
  sections: string
  module: string
}

interface FeatureEntry {
  id: string
  title: string
  module: string
  sections: { key: string; title: string }[]
}

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

const features = ref<FeatureEntry[]>([])
const searchQuery = ref('')
const selectedFeatureId = ref<string | null>(null)
const selectedSectionKey = ref<string | null>(null)
const expandedFeatureId = ref<string | null>(null)
const customLabel = ref('')
const loading = ref(false)
const error = ref('')

const moduleGroups = computed(() => {
  const filtered = searchQuery.value
    ? features.value.filter(
        (f: FeatureEntry) =>
          f.title.includes(searchQuery.value) ||
          f.module.includes(searchQuery.value) ||
          f.sections.some((s: { key: string; title: string }) =>
            s.title.includes(searchQuery.value),
          ),
      )
    : features.value

  const groups: Record<string, FeatureEntry[]> = {}
  for (const f of filtered) {
    const mod = f.module || '未分类'
    if (!groups[mod]) groups[mod] = []
    groups[mod].push(f)
  }
  return groups
})

const selectedLabel = computed(() => {
  if (!selectedFeatureId.value) return ''
  const f = features.value.find((f: FeatureEntry) => f.id === selectedFeatureId.value)
  if (!f) return ''
  if (selectedSectionKey.value) {
    const sec = f.sections.find(
      (s: { key: string; title: string }) => s.key === selectedSectionKey.value,
    )
    return sec ? `${f.title} › ${sec.title}` : f.title
  }
  return f.title
})

async function loadFeatures() {
  if (!currentProjectId.value) return
  loading.value = true
  error.value = ''
  try {
    const list = (await getFeatures(currentProjectId.value)) as unknown as FeatureApiEntry[]
    features.value = list.map((f) => ({
      id: f.id,
      title: f.title,
      module: f.module,
      sections: JSON.parse(f.sections || '[]') as { key: string; title: string }[],
    }))
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
  const f = features.value.find((f: FeatureEntry) => f.id === selectedFeatureId.value)
  if (!f) return

  const label = customLabel.value.trim() || selectedLabel.value

  if (selectedSectionKey.value) {
    const sec = f.sections.find(
      (s: { key: string; title: string }) => s.key === selectedSectionKey.value,
    )
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

watch(expandedFeatureId, (id) => {
  if (id) customLabel.value = selectedLabel.value
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
      if (features.value.length === 0) loadFeatures()
    }
  },
)

watch(currentProjectId, () => {
  if (props.visible) loadFeatures()
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
        <div v-for="(items, mod) in moduleGroups" :key="mod" class="mb-3">
          <div class="text-xs text-muted font-medium mb-1.5 px-1">
            {{ mod }}
          </div>

          <div v-for="f in items" :key="f.id">
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
              class="ml-7 mt-0.5 mb-1 border-l-2 border-light pl-4"
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
    <div class="flex items-center justify-between pt-3 mt-3 border-t border-light">
      <button v-if="currentFeatureId" class="btn-danger text-sm" @click="removeRef">
        移除引用
      </button>
      <div v-else />

      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-xs text-secondary whitespace-nowrap">显示名称</label>
          <input
            v-model="customLabel"
            type="text"
            class="w-36 px-2 py-1.5 text-sm border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
            placeholder="引用显示文字"
          />
        </div>
        <button class="btn-secondary text-sm" @click="() => emit('close')">取消</button>
        <button class="btn-primary text-sm" :disabled="!selectedFeatureId" @click="confirm">
          插入引用
        </button>
      </div>
    </div>
  </ModalDialog>
</template>
