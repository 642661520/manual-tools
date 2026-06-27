<script setup lang="ts">
import { ref, watch } from 'vue'
import { aiChat } from '@/api/endpoints/ai'

const props = defineProps<{ visible: boolean; selectedText: string }>()
const emit = defineEmits<{ close: []; apply: [html: string] }>()

const loading = ref(false)
const result = ref('')
const error = ref('')
const customPrompt = ref('')
const lastAction = ref<{ type: 'preset'; key: string } | { type: 'custom'; prompt: string } | null>(
  null,
)

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      result.value = ''
      error.value = ''
      customPrompt.value = ''
      lastAction.value = null
    }
  },
)

const presets = [
  { key: 'polish' as const, label: '润色', desc: '更清晰专业' },
  { key: 'fix' as const, label: '纠错', desc: '修正语法错字' },
  { key: 'expand' as const, label: '扩写', desc: '详细步骤说明' },
  { key: 'summarize' as const, label: '精简', desc: '提取核心要点' },
]

async function runPreset(key: string) {
  lastAction.value = { type: 'preset', key }
  loading.value = true
  error.value = ''
  result.value = ''
  try {
    const res = await aiChat({ action: key as 'polish', content: props.selectedText })
    result.value = res.result
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '请求失败'
  } finally {
    loading.value = false
  }
}

async function runCustom() {
  const p = customPrompt.value.trim()
  if (!p) return
  lastAction.value = { type: 'custom', prompt: p }
  loading.value = true
  error.value = ''
  result.value = ''
  try {
    const res = await aiChat({ action: 'custom', content: props.selectedText, instruction: p })
    result.value = res.result
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '请求失败'
  } finally {
    loading.value = false
  }
}

async function retry() {
  if (!lastAction.value) return
  if (lastAction.value.type === 'preset') await runPreset(lastAction.value.key)
  else {
    customPrompt.value = lastAction.value.prompt
    await runCustom()
  }
}

function apply() {
  emit('apply', result.value)
  result.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key === 'Enter' && customPrompt.value.trim()) {
    e.preventDefault()
    runCustom()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-[60]" @click.self="emit('close')">
      <div
        class="absolute left-1/2 top-[20vh] -translate-x-1/2 bg-white rounded-xl shadow-2xl border border-gray-200 w-[480px] max-w-[95vw] overflow-hidden"
      >
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span class="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <span class="i-lucide-sparkles w-4 h-4 text-violet-500" />AI 助手
          </span>
          <button class="text-gray-400 hover:text-gray-600" @click="emit('close')">
            <span class="i-lucide-x w-4 h-4" />
          </button>
        </div>

        <div class="px-4 py-3 space-y-3">
          <div
            class="flex items-start gap-2 text-xs bg-gray-50 rounded-lg p-2.5 border border-gray-100"
          >
            <span
              class="i-lucide-mouse-pointer-click w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5"
            />
            <span class="text-gray-500 line-clamp-2">{{ selectedText }}</span>
          </div>

          <div class="flex gap-2">
            <button
              v-for="p in presets"
              :key="p.key"
              class="flex-1 flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg border border-gray-200 hover:border-violet-300 hover:bg-violet-50 transition-colors"
              :class="{ 'opacity-50 pointer-events-none': loading }"
              :disabled="loading"
              @click="runPreset(p.key)"
            >
              <span class="text-sm font-medium text-gray-700">{{ p.label }}</span>
              <span class="text-[10px] text-gray-400">{{ p.desc }}</span>
            </button>
          </div>

          <div class="flex gap-2">
            <input
              v-model="customPrompt"
              type="text"
              class="input text-sm flex-1"
              placeholder="或输入自定义指令，如「翻译为英文」"
              :disabled="loading"
              @keydown="onKeydown"
            />
            <button
              class="btn-primary text-xs px-3 flex-shrink-0"
              :disabled="loading || !customPrompt.trim()"
              @click="runCustom"
            >
              发送
            </button>
          </div>

          <div
            v-if="loading"
            class="flex items-center gap-2 py-4 justify-center text-sm text-gray-400"
          >
            <span class="i-lucide-loader-2 w-4 h-4 animate-spin" />
            正在处理「{{ selectedText.slice(0, 30) }}{{ selectedText.length > 30 ? '…' : '' }}」...
          </div>

          <div v-if="error" class="text-sm text-red-500 bg-red-50 rounded-lg p-3">{{ error }}</div>

          <div v-if="result && !loading" class="space-y-3">
            <div
              class="bg-violet-50 rounded-lg p-3 max-h-64 overflow-y-auto text-sm text-gray-700 leading-relaxed"
              v-html="result"
            />
            <div class="flex gap-2">
              <button class="btn-primary text-sm flex-1" @click="apply">
                <span class="i-lucide-check w-4 h-4 inline-block align-middle mr-1" />替换原文
              </button>
              <button class="btn-secondary text-sm" @click="retry">
                <span class="i-lucide-rotate-ccw w-4 h-4 inline-block align-middle mr-1" />重试
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
