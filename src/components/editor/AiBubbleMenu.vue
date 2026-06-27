<script setup lang="ts">
/**
 * AI 浮动气泡 — 选中文本后出现在选区附近
 * 纯 DOM 定位，不依赖 TipTap 的 BubbleMenu API
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import AiPopover from './AiPopover.vue'

const props = defineProps<{ editor: Editor }>()

const showToolbar = ref(false)
const showPopover = ref(false)
const toolbarStyle = ref<Record<string, string>>({})

const selectedText = computed(() => {
  const { from, to } = props.editor.state.selection
  return from < to ? props.editor.state.doc.textBetween(from, to, ' ') : ''
})

function updatePosition() {
  const { from, to } = props.editor.state.selection
  if (from === to) { showToolbar.value = false; return }
  showToolbar.value = true
  // 获取选区边界位置
  const start = props.editor.view.coordsAtPos(from)
  const end = props.editor.view.coordsAtPos(to)
  const midX = (start.left + end.left) / 2
  toolbarStyle.value = { left: `${midX}px`, top: `${start.top - 44}px`, transform: 'translateX(-50%)' }
}

function onAiApply(html: string) {
  const { from, to } = props.editor.state.selection
  showPopover.value = false
  if (from < to) {
    props.editor.chain().focus().deleteSelection().insertContent(html).run()
  }
}

// 监听 Selection 变化
watch(() => props.editor, (ed) => {
  ed?.on('selectionUpdate', updatePosition)
  ed?.on('blur', () => { setTimeout(() => showToolbar.value = false, 200) })
}, { immediate: true })
</script>

<template>
  <!-- 浮动工具栏 -->
  <Teleport to="body">
    <div
      v-if="showToolbar"
      class="fixed z-50 flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-gray-200 px-1 py-1 transition-opacity"
      :style="toolbarStyle"
    >
      <button class="w-8 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600" title="加粗" @mousedown.prevent="editor.chain().focus().toggleBold().run()">
        <span class="i-lucide-bold w-4 h-4" />
      </button>
      <button class="w-8 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600" title="斜体" @mousedown.prevent="editor.chain().focus().toggleItalic().run()">
        <span class="i-lucide-italic w-4 h-4" />
      </button>
      <button class="w-8 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600" title="删除线" @mousedown.prevent="editor.chain().focus().toggleStrike().run()">
        <span class="i-lucide-strikethrough w-4 h-4" />
      </button>
      <button class="w-8 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600" title="链接" @mousedown.prevent="editor.chain().focus().toggleLink({ href: '' }).run()">
        <span class="i-lucide-link w-4 h-4" />
      </button>
      <div class="w-px h-4 bg-gray-200 mx-0.5" />
      <button
        class="flex items-center gap-1 h-7 px-2 rounded text-xs font-medium transition-colors"
        :class="showPopover ? 'bg-violet-100 text-violet-700' : 'text-violet-500 hover:bg-violet-50'"
        @mousedown.prevent="showPopover = !showPopover"
      >
        <span class="i-lucide-sparkles w-3.5 h-3.5" />AI
      </button>
    </div>
  </Teleport>

  <AiPopover
    :visible="showPopover"
    :selected-text="selectedText"
    @close="showPopover = false"
    @apply="onAiApply"
  />
</template>
