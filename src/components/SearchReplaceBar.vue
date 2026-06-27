<script setup lang="ts">
import { watch, ref, nextTick } from 'vue'
import type { Editor } from '@tiptap/core'

const props = defineProps<{
  editor: Editor | undefined
}>()

const emit = defineEmits<{
  close: []
}>()

// 动态导入 composable 以避免循环依赖
// 直接内联逻辑，保持组件自包含
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import { searchPluginKey } from '@/composables/search-highlight'

interface Match {
  from: number
  to: number
}

const searchTerm = ref('')
const replaceTerm = ref('')
const caseSensitive = ref(false)
const showReplace = ref(false)
const matches = ref<Match[]>([])
const currentIndex = ref(-1)
const searchInput = ref<HTMLInputElement>()

const matchCount = matches.value.length

function normalizedTerm() {
  return caseSensitive.value ? searchTerm.value : searchTerm.value.toLowerCase()
}

function findMatches(): Match[] {
  const ed = props.editor
  if (!ed || !searchTerm.value) return []

  const term = normalizedTerm()
  const results: Match[] = []

  ed.state.doc.descendants((node, pos) => {
    if (node.isText) {
      const text = caseSensitive.value ? (node.text ?? '') : (node.text ?? '').toLowerCase()
      let idx = 0
      while ((idx = text.indexOf(term, idx)) !== -1) {
        results.push({ from: pos + idx, to: pos + idx + searchTerm.value.length })
        idx += searchTerm.value.length
      }
    }
  })

  return results
}

function applyDecorations() {
  const ed = props.editor
  if (!ed) return

  if (matches.value.length === 0) {
    ed.view.dispatch(ed.state.tr.setMeta(searchPluginKey, DecorationSet.empty))
    return
  }

  const decos = matches.value.map((m, i) => {
    const klass = i === currentIndex.value ? 'search-match-current' : 'search-match'
    return Decoration.inline(m.from, m.to, { class: klass })
  })

  ed.view.dispatch(ed.state.tr.setMeta(searchPluginKey, DecorationSet.create(ed.state.doc, decos)))
}

function clearDecorations() {
  const ed = props.editor
  if (!ed) return
  matches.value = []
  currentIndex.value = -1
  ed.view.dispatch(ed.state.tr.setMeta(searchPluginKey, DecorationSet.empty))
}

function doSearch() {
  matches.value = findMatches()
  currentIndex.value = matches.value.length > 0 ? 0 : -1
  if (matches.value.length > 0) {
    selectMatch(0)
  } else {
    applyDecorations()
  }
}

function selectMatch(index: number) {
  const ed = props.editor
  if (!ed || index < 0 || index >= matches.value.length) return

  currentIndex.value = index
  const m = matches.value[index]

  // 单事务：装饰更新 + 设置选区
  const decos = matches.value.map((match, i) => {
    const klass = i === index ? 'search-match-current' : 'search-match'
    return Decoration.inline(match.from, match.to, { class: klass })
  })

  ed.view.dispatch(
    ed.state.tr
      .setMeta(searchPluginKey, DecorationSet.create(ed.state.doc, decos))
      .setSelection(TextSelection.create(ed.state.doc, m.from, m.to)),
  )

  // 用坐标精确滚动：coordsAtPos 不受 decoration span 干扰
  const coords = ed.view.coordsAtPos(m.from)
  if (coords) {
    const scrollContainer = ed.view.dom.closest('.overflow-y-auto') as HTMLElement | null
    if (scrollContainer) {
      const rect = scrollContainer.getBoundingClientRect()
      const targetY = scrollContainer.scrollTop + coords.top - rect.top - rect.height / 3
      scrollContainer.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' })
    }
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    doSearch()
  }, 150)
}

watch(searchTerm, () => {
  if (searchTerm.value) {
    scheduleSearch()
  } else {
    clearDecorations()
  }
})

watch(caseSensitive, () => {
  if (searchTerm.value) doSearch()
})

function onFindKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) {
      prev()
    } else {
      next()
    }
  }
}

function onReplaceKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    replaceOne()
  }
}

function next() {
  if (matches.value.length === 0) return
  const idx = (currentIndex.value + 1) % matches.value.length
  selectMatch(idx)
}

function prev() {
  if (matches.value.length === 0) return
  const idx = (currentIndex.value - 1 + matches.value.length) % matches.value.length
  selectMatch(idx)
}

function replaceOne() {
  const ed = props.editor
  if (!ed || currentIndex.value < 0 || currentIndex.value >= matches.value.length) return

  const m = matches.value[currentIndex.value]
  ed.chain()
    .focus()
    .setTextSelection({ from: m.from, to: m.to })
    .insertContent(replaceTerm.value)
    .run()
  doSearch()
}

function replaceAll() {
  const ed = props.editor
  if (!ed || matches.value.length === 0) return

  const sorted = [...matches.value].sort((a, b) => b.from - a.from)
  for (const m of sorted) {
    ed.chain().setTextSelection({ from: m.from, to: m.to }).insertContent(replaceTerm.value).run()
  }
  doSearch()
}

function close() {
  clearDecorations()
  emit('close')
}

// 打开时聚焦搜索框
function focusSearch() {
  nextTick(() => {
    searchInput.value?.focus()
    // 预填选区文本
    const ed = props.editor
    if (ed) {
      const { from, to } = ed.state.selection
      if (from !== to) {
        searchTerm.value = ed.state.doc.textBetween(from, to)
        scheduleSearch()
      }
    }
  })
}

defineExpose({ focusSearch })
</script>

<template>
  <div
    class="search-replace-bar flex items-center gap-2 px-3 py-1.5 bg-white border-b border-gray-200 text-sm"
  >
    <!-- 查找 -->
    <div class="flex items-center gap-1 flex-1 min-w-0">
      <span class="i-lucide-search w-4 h-4 text-gray-400 flex-shrink-0" />
      <input
        ref="searchInput"
        v-model="searchTerm"
        class="flex-1 min-w-0 border-none outline-none bg-transparent text-sm py-0.5"
        :class="searchTerm && matches.length === 0 ? 'text-red-500' : ''"
        placeholder="查找..."
        @keydown="onFindKeydown"
      />
      <span
        v-if="searchTerm"
        class="text-xs text-gray-400 flex-shrink-0 tabular-nums min-w-10 text-right"
      >
        {{ matches.length > 0 ? `${currentIndex + 1}/${matches.length}` : '无结果' }}
      </span>
    </div>

    <!-- 区分大小写 -->
    <button
      class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors"
      :class="caseSensitive ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:text-gray-600'"
      v-tooltip="'区分大小写'"
      @click="caseSensitive = !caseSensitive"
    >
      <span class="i-lucide-case-sensitive w-4 h-4 inline-block align-middle" />
    </button>

    <!-- 上下导航 -->
    <button
      class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
      :class="{ 'opacity-30': matches.length === 0 }"
      v-tooltip="'上一个 (Shift+Enter)'"
      @click="prev"
    >
      <span class="i-lucide-chevron-up w-4 h-4" />
    </button>
    <button
      class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
      :class="{ 'opacity-30': matches.length === 0 }"
      v-tooltip="'下一个 (Enter)'"
      @click="next"
    >
      <span class="i-lucide-chevron-down w-4 h-4" />
    </button>

    <!-- 切换替换 -->
    <button
      class="flex-shrink-0 px-1.5 py-0.5 rounded text-xs transition-colors"
      :class="showReplace ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600'"
      v-tooltip="'切换替换'"
      @click="showReplace = !showReplace"
    >
      <span class="i-lucide-chevrons-left-right w-3.5 h-3.5 inline-block align-middle" />
    </button>

    <!-- 替换操作 -->
    <template v-if="showReplace">
      <button
        class="flex-shrink-0 btn text-xs !px-2 !py-0.5"
        :class="{ 'opacity-30': matches.length === 0 }"
        :disabled="matches.length === 0"
        @click="replaceOne"
      >
        替换
      </button>
      <button
        class="flex-shrink-0 btn-secondary text-xs !px-2 !py-0.5"
        :class="{ 'opacity-30': matches.length === 0 }"
        :disabled="matches.length === 0"
        @click="replaceAll"
      >
        全部替换
      </button>
    </template>

    <!-- 关闭 -->
    <button
      class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400"
      v-tooltip="'关闭 (Esc)'"
      @click="close"
    >
      <span class="i-lucide-x w-4 h-4" />
    </button>
  </div>

  <!-- 替换行 -->
  <div
    v-if="showReplace"
    class="flex items-center gap-2 px-3 py-1.5 bg-white border-b border-gray-200 text-sm"
  >
    <span class="i-lucide-corner-down-right w-4 h-4 text-gray-400 flex-shrink-0" />
    <input
      v-model="replaceTerm"
      class="flex-1 border-none outline-none bg-transparent text-sm py-0.5"
      placeholder="替换为..."
      @keydown="onReplaceKeydown"
    />
  </div>
</template>
