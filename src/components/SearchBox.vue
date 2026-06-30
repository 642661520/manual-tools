<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProject } from '@/composables/useProject'
import { showErrorToast } from '@/composables/toast'
import { search, type SearchResult } from '@/api/endpoints/search'

const router = useRouter()
const { currentProjectId } = useProject()

const visible = ref(false)
const query = ref('')
const results = ref<SearchResult[]>([])
const total = ref(0)
const searching = ref(false)
const selectedIndex = ref(-1)
const inputRef = ref<HTMLInputElement>()

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function open() {
  visible.value = true
  query.value = ''
  results.value = []
  total.value = 0
  selectedIndex.value = -1
  setTimeout(() => inputRef.value?.focus(), 50)
}

function close() {
  visible.value = false
}

async function doSearch() {
  if (!query.value.trim() || !currentProjectId.value) {
    results.value = []
    total.value = 0
    return
  }
  searching.value = true
  try {
    const res = await search(query.value, currentProjectId.value)
    results.value = res.results
    total.value = res.total
    selectedIndex.value = -1
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '搜索失败')
    results.value = []
  } finally {
    searching.value = false
  }
}

watch(query, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(doSearch, 200)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, results.value.length - 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, -1)
    return
  }
  if (e.key === 'Enter' && selectedIndex.value >= 0) {
    e.preventDefault()
    goTo(results.value[selectedIndex.value])
  }
}

function goTo(r: SearchResult) {
  close()
  const sec = r.sectionKey !== '_default' ? `&section=${r.sectionKey}` : ''
  router.push(`/features/${r.featureId}/edit?find=${encodeURIComponent(query.value)}${sec}`)
}

// Ctrl+K / Cmd+K
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    open()
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown))

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/30"
      @click.self="close"
    >
      <div class="bg-surface rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
        <!-- Search input -->
        <div class="flex items-center gap-3 px-4 py-3 border-b border-default">
          <span class="i-lucide-search w-5 h-5 text-muted flex-shrink-0" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            class="flex-1 outline-none text-base bg-transparent text-primary placeholder:text-muted"
            :placeholder="currentProjectId ? '搜索当前项目中的手册内容...' : '请先选择一个项目'"
            @keydown="onKeydown"
          />
          <kbd class="hidden sm:inline-block text-xs text-muted bg-hover px-1.5 py-0.5 rounded"
            >Esc</kbd
          >
        </div>

        <!-- Results -->
        <div class="max-h-80 overflow-y-auto">
          <div
            v-if="searching"
            class="flex items-center gap-2 px-4 py-8 text-sm text-muted justify-center"
          >
            <span class="i-lucide-loader-2 w-4 h-4 animate-spin" />搜索中...
          </div>
          <div
            v-else-if="query && results.length === 0"
            class="px-4 py-8 text-sm text-muted text-center"
          >
            未找到相关结果
          </div>
          <template v-else-if="results.length > 0">
            <div
              v-for="(r, i) in results"
              :key="r.docId"
              class="px-4 py-3 cursor-pointer hover:bg-hover transition-colors"
              :class="{ 'bg-active': i === selectedIndex }"
              @click="() => goTo(r)"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="i-lucide-file-text w-4 h-4 text-muted flex-shrink-0" />
                <span class="text-sm font-medium text-primary truncate">{{ r.title }}</span>
                <span class="text-xs text-muted">· {{ r.sectionTitle }}</span>
              </div>
              <!-- eslint-disable vue/no-v-html -- 搜索片段含 <mark> 高亮标签，后端生成 -->
              <div class="text-xs text-secondary leading-relaxed" v-html="r.snippet" />
              <!-- eslint-enable vue/no-v-html -->
            </div>
          </template>
        </div>
        <div v-if="results.length > 0" class="px-4 py-2 text-xs text-muted border-t border-light">
          共 {{ total }} 条结果
        </div>
      </div>
    </div>
  </Teleport>
</template>
