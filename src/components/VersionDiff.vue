<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { getDiff, type DiffResult } from '@/api/endpoints/diff'
import SelectDropdown from '@/components/SelectDropdown.vue'
import type { SelectOption } from '@/components/SelectDropdown.vue'

const props = defineProps<{
  visible: boolean
  catalogId: string
  versions: Array<{ id: string; versionMajor: number; versionMinor: number; title: string }>
}>()

const emit = defineEmits<{ close: [] }>()

const v1 = ref<string | null>(null)
const v2 = ref<string | null>(null)
const loading = ref(false)
const result = ref<DiffResult | null>(null)
const error = ref('')

const versionOptions = computed<SelectOption[]>(() =>
  props.versions.map(v => ({
    value: v.id,
    label: `v${v.versionMajor}.${v.versionMinor} ${v.title}`,
  }))
)

watch(() => props.visible, (v) => {
  if (!v) { result.value = null; error.value = ''; v1.value = null; v2.value = null }
})

async function doDiff() {
  if (!v1.value || !v2.value) return
  loading.value = true; error.value = ''; result.value = null
  try {
    result.value = await getDiff(props.catalogId, v1.value, v2.value)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '对比失败'
  } finally { loading.value = false }
}

function onV1Change(val: string | number | null) { v1.value = val as string; doDiff() }
function onV2Change(val: string | number | null) { v2.value = val as string; doDiff() }
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40" @click.self="emit('close')">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[80vh] flex flex-col overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
          <span class="text-sm font-semibold text-gray-700">版本对比</span>
          <div class="flex items-center gap-3">
            <SelectDropdown
              :model-value="v1"
              :options="versionOptions"
              placeholder="旧版本"
              width-class="w-56"
              @update:model-value="onV1Change"
            />
            <span class="text-gray-300">→</span>
            <SelectDropdown
              :model-value="v2"
              :options="versionOptions"
              placeholder="新版本"
              width-class="w-56"
              @update:model-value="onV2Change"
            />
            <button class="text-gray-400 hover:text-gray-600" @click="emit('close')"><span class="i-lucide-x w-4 h-4" /></button>
          </div>
        </div>

        <div v-if="loading" class="flex items-center gap-2 justify-center py-12 text-sm text-gray-400">
          <span class="i-lucide-loader-2 w-4 h-4 animate-spin" />加载中...
        </div>
        <div v-else-if="error" class="p-6 text-center text-sm text-red-500">{{ error }}</div>
        <div v-else-if="result" class="flex-1 overflow-y-auto">
          <div class="flex gap-4 px-5 py-2 border-b border-gray-100 bg-gray-50 text-xs text-gray-500 sticky top-0">
            <span class="text-green-600">+{{ result.stats.added }}</span>
            <span class="text-red-500">-{{ result.stats.removed }}</span>
            <span>{{ result.stats.unchanged }} unchanged</span>
          </div>
          <div class="font-mono text-sm">
            <div
              v-for="(line, i) in result.lines" :key="i" class="px-5 py-0.5"
              :class="line.type === 'added' ? 'bg-green-50 text-green-800' : line.type === 'removed' ? 'bg-red-50 text-red-700' : 'text-gray-700'"
            >
              <span class="inline-block w-5 text-xs text-gray-400 flex-shrink-0 select-none mr-2 text-right">
                {{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}
              </span>
              {{ line.text }}
            </div>
          </div>
        </div>
        <div v-else class="p-6 text-center text-sm text-gray-400">请选择两个版本进行对比</div>
      </div>
    </div>
  </Teleport>
</template>
