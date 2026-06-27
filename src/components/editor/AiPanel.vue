<script setup lang="ts">
import { ref } from 'vue'
import { aiChat } from '@/api/endpoints/ai'

const props = defineProps<{
  selectedText: string
  fullContent: string
}>()

const emit = defineEmits<{
  replace: [text: string]
}>()

const loading = ref(false)
const result = ref('')
const error = ref('')

async function run(action: 'polish' | 'summarize' | 'fix' | 'expand') {
  loading.value = true
  error.value = ''
  result.value = ''
  try {
    const res = await aiChat({ action, content: props.selectedText || props.fullContent })
    result.value = res.result
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '请求失败'
  } finally {
    loading.value = false
  }
}

function accept() {
  emit('replace', result.value)
  result.value = ''
}

function discard() {
  result.value = ''
}

const actions = [
  { key: 'polish' as const, label: '润色', desc: '让文字更清晰专业', icon: 'i-lucide-sparkles' },
  { key: 'fix' as const, label: '纠错', desc: '修正语法和错别字', icon: 'i-lucide-check-circle' },
  { key: 'expand' as const, label: '扩写', desc: '展开为详细步骤', icon: 'i-lucide-file-plus' },
  { key: 'summarize' as const, label: '摘要', desc: '提取核心要点', icon: 'i-lucide-file-text' },
]
</script>

<template>
  <div class="p-3 space-y-3 h-full flex flex-col">
    <div class="text-xs text-gray-500 font-medium flex items-center gap-1.5">
      <span class="i-lucide-sparkles w-3.5 h-3.5" />AI 助手
    </div>

    <div v-if="!props.selectedText" class="text-xs text-gray-400 bg-yellow-50 rounded p-2">
      在编辑器中选中文本后可使用，或对全文操作
    </div>

    <div class="grid grid-cols-2 gap-2" :class="{ 'opacity-50 pointer-events-none': loading }">
      <button
        v-for="a in actions" :key="a.key"
        class="flex flex-col items-center gap-0.5 p-2 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
        @click="run(a.key)"
      >
        <span :class="a.icon" class="w-4 h-4 text-blue-500" />
        <span class="text-xs font-medium text-gray-700">{{ a.label }}</span>
        <span class="text-[10px] text-gray-400">{{ a.desc }}</span>
      </button>
    </div>

    <div v-if="loading" class="flex items-center gap-2 text-xs text-gray-400 justify-center py-4">
      <span class="i-lucide-loader-2 w-4 h-4 animate-spin" />AI 处理中...
    </div>

    <div v-if="error" class="text-xs text-red-500 bg-red-50 rounded p-2">{{ error }}</div>

    <div v-if="result" class="flex-1 flex flex-col min-h-0">
      <div class="text-xs text-gray-400 mb-1">结果：</div>
      <div class="flex-1 overflow-y-auto bg-gray-50 rounded p-2 text-sm text-gray-700 whitespace-pre-wrap">{{ result }}</div>
      <div class="flex gap-2 mt-2">
        <button class="btn-primary text-xs flex-1" @click="accept">
          <span class="i-lucide-check w-3.5 h-3.5 inline-block align-middle mr-1" />替换
        </button>
        <button class="btn-secondary text-xs" @click="discard">
          <span class="i-lucide-x w-3.5 h-3.5 inline-block align-middle mr-1" />丢弃
        </button>
      </div>
    </div>
  </div>
</template>
