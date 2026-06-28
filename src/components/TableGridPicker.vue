<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import type { Editor } from '@tiptap/core'

const props = defineProps<{
  editor: Editor | null
  editable: boolean
}>()

const MAX_ROWS = 10
const MAX_COLS = 10

const isOpen = ref(false)
const hoverRow = ref(0)
const hoverCol = ref(0)
const triggerRef = ref<HTMLElement | null>(null)
const popupRef = ref<HTMLElement | null>(null)
const popupStyle = ref<Record<string, string>>({})

const displayRows = () => hoverRow.value || 1
const displayCols = () => hoverCol.value || 1

function updatePosition() {
  if (!isOpen.value || !triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const estimatedHeight = MAX_ROWS * 20 + 56 // cells + padding + label

  popupStyle.value = {
    left: `${rect.left}px`,
  }

  if (rect.bottom + estimatedHeight <= window.innerHeight) {
    popupStyle.value.top = `${rect.bottom + 4}px`
  } else {
    popupStyle.value.bottom = `${window.innerHeight - rect.top + 4}px`
  }
}

function open() {
  if (!props.editable) return
  isOpen.value = true
  nextTick(updatePosition)
}

function close() {
  isOpen.value = false
  hoverRow.value = 0
  hoverCol.value = 0
}

function toggle() {
  if (isOpen.value) {
    close()
  } else {
    open()
  }
}

function onHover(r: number, c: number) {
  hoverRow.value = r
  hoverCol.value = c
}

function onGridLeave() {
  hoverRow.value = 0
  hoverCol.value = 0
}

function insert(r: number, c: number) {
  if (props.editor && r > 0 && c > 0) {
    props.editor.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: true }).run()
  }
  close()
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault()
    open()
  }
}

function onPopupKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    triggerRef.value?.focus()
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (hoverRow.value > 0 && hoverCol.value > 0) {
      insert(hoverRow.value, hoverCol.value)
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    hoverRow.value = Math.min(hoverRow.value + 1, MAX_ROWS)
    if (hoverCol.value === 0) hoverCol.value = 1
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    hoverRow.value = Math.max(hoverRow.value - 1, 1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    hoverCol.value = Math.min(hoverCol.value + 1, MAX_COLS)
    if (hoverRow.value === 0) hoverRow.value = 1
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    hoverCol.value = Math.max(hoverCol.value - 1, 1)
  }
}

function onClickOutside(e: MouseEvent) {
  if (!isOpen.value) return
  const target = e.target as Node
  if (popupRef.value?.contains(target)) return
  if (triggerRef.value?.contains(target)) return
  close()
}

function onReposition() {
  if (isOpen.value) updatePosition()
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  window.addEventListener('scroll', onReposition, true)
  window.addEventListener('resize', onReposition)
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener('scroll', onReposition, true)
  window.removeEventListener('resize', onReposition)
})
</script>

<template>
  <div class="relative inline-flex">
    <button
      ref="triggerRef"
      v-tooltip="'插入表格'"
      class="w-8 h-8 flex items-center justify-center rounded hover:bg-hover text-sm"
      :class="{ 'bg-[var(--c-border)]': isOpen }"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="i-lucide-table w-4 h-4 inline-block align-middle" />
    </button>

    <Teleport to="body">
      <Transition name="dropdown">
        <div
          v-if="isOpen"
          ref="popupRef"
          class="fixed z-[9999] bg-surface rounded-xl shadow-lg border border-default p-3 select-none"
          :style="popupStyle"
          @keydown="onPopupKeydown"
        >
          <div class="text-xs text-muted text-center mb-2 leading-none">
            插入表格：<span class="text-secondary font-medium"
              >{{ displayRows() }} × {{ displayCols() }}</span
            >
          </div>
          <div
            class="grid gap-px bg-[var(--c-border)] rounded overflow-hidden"
            :style="{ gridTemplateColumns: `repeat(${MAX_COLS}, 1.25rem)` }"
            @mouseleave="onGridLeave"
          >
            <template v-for="r in MAX_ROWS" :key="r">
              <div
                v-for="c in MAX_COLS"
                :key="`${r}-${c}`"
                class="w-5 h-5 cursor-pointer transition-colors duration-75"
                :class="r <= hoverRow && c <= hoverCol ? 'bg-blue-500' : 'bg-surface'"
                @mouseenter="() => onHover(r, c)"
                @click="() => insert(r, c)"
              />
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.dropdown-enter-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.dropdown-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
