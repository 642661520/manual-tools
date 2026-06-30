<script setup lang="ts">
import { computed } from 'vue'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import type { Editor } from '@tiptap/core'

const props = defineProps<{
  editor: Editor | null
  editable?: boolean
}>()

const isEditable = computed(() => (props.editable ?? true) && (props.editor?.isEditable ?? false))

function shouldShow({ editor }: { editor: Editor }): boolean {
  return editor.isActive('table') && isEditable.value
}

const canDeleteRow = computed(() => props.editor?.can().deleteRow() ?? false)
const canDeleteColumn = computed(() => props.editor?.can().deleteColumn() ?? false)
const canMergeCells = computed(() => props.editor?.can().mergeCells() ?? false)
const canSplitCell = computed(() => props.editor?.can().splitCell() ?? false)

function addRowBefore() {
  props.editor?.chain().focus().addRowBefore().run()
}
function addRowAfter() {
  props.editor?.chain().focus().addRowAfter().run()
}
function deleteRow() {
  props.editor?.chain().focus().deleteRow().run()
}
function addColumnBefore() {
  props.editor?.chain().focus().addColumnBefore().run()
}
function addColumnAfter() {
  props.editor?.chain().focus().addColumnAfter().run()
}
function deleteColumn() {
  props.editor?.chain().focus().deleteColumn().run()
}
function mergeCells() {
  props.editor?.chain().focus().mergeCells().run()
}
function splitCell() {
  props.editor?.chain().focus().splitCell().run()
}
function deleteTable() {
  props.editor?.chain().focus().deleteTable().run()
}
</script>

<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    :should-show="shouldShow"
    :options="{ offset: 8, placement: 'top' }"
  >
    <div
      class="flex items-center gap-0.5 px-1.5 py-1 bg-surface rounded-lg shadow-lg border border-default"
    >
      <!-- 行操作 -->
      <button
        v-tooltip="'上方插入行'"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover text-sm"
        :class="{ 'opacity-40 cursor-not-allowed': !isEditable }"
        :disabled="!isEditable"
        @click="addRowBefore"
      >
        <span class="i-lucide-arrow-up-to-line w-3.5 h-3.5 inline-block align-middle" />
      </button>
      <button
        v-tooltip="'下方插入行'"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover text-sm"
        :class="{ 'opacity-40 cursor-not-allowed': !isEditable }"
        :disabled="!isEditable"
        @click="addRowAfter"
      >
        <span class="i-lucide-arrow-down-to-line w-3.5 h-3.5 inline-block align-middle" />
      </button>
      <button
        v-tooltip="'删除行'"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover text-sm"
        :class="{ 'opacity-40 cursor-not-allowed': !isEditable || !canDeleteRow }"
        :disabled="!isEditable || !canDeleteRow"
        @click="deleteRow"
      >
        <span class="i-lucide-trash-2 w-3.5 h-3.5 inline-block align-middle" />
      </button>

      <div class="w-px h-4 bg-[var(--c-border)] mx-0.5" />

      <!-- 列操作 -->
      <button
        v-tooltip="'左侧插入列'"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover text-sm"
        :class="{ 'opacity-40 cursor-not-allowed': !isEditable }"
        :disabled="!isEditable"
        @click="addColumnBefore"
      >
        <span class="i-lucide-arrow-left-to-line w-3.5 h-3.5 inline-block align-middle" />
      </button>
      <button
        v-tooltip="'右侧插入列'"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover text-sm"
        :class="{ 'opacity-40 cursor-not-allowed': !isEditable }"
        :disabled="!isEditable"
        @click="addColumnAfter"
      >
        <span class="i-lucide-arrow-right-to-line w-3.5 h-3.5 inline-block align-middle" />
      </button>
      <button
        v-tooltip="'删除列'"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover text-sm"
        :class="{ 'opacity-40 cursor-not-allowed': !isEditable || !canDeleteColumn }"
        :disabled="!isEditable || !canDeleteColumn"
        @click="deleteColumn"
      >
        <span class="i-lucide-trash-2 w-3.5 h-3.5 inline-block align-middle" />
      </button>

      <div class="w-px h-4 bg-[var(--c-border)] mx-0.5" />

      <!-- 单元格操作 -->
      <button
        v-tooltip="'合并单元格'"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover text-sm"
        :class="{ 'opacity-40 cursor-not-allowed': !isEditable || !canMergeCells }"
        :disabled="!isEditable || !canMergeCells"
        @click="mergeCells"
      >
        <span class="i-lucide-table-cells-merge w-3.5 h-3.5 inline-block align-middle" />
      </button>
      <button
        v-tooltip="'拆分单元格'"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover text-sm"
        :class="{ 'opacity-40 cursor-not-allowed': !isEditable || !canSplitCell }"
        :disabled="!isEditable || !canSplitCell"
        @click="splitCell"
      >
        <span class="i-lucide-table-cells-split w-3.5 h-3.5 inline-block align-middle" />
      </button>

      <div class="w-px h-4 bg-[var(--c-border)] mx-0.5" />

      <!-- 删除表格 -->
      <button
        v-tooltip="'删除表格'"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-danger text-sm color-danger"
        :class="{ 'opacity-40 cursor-not-allowed': !isEditable }"
        :disabled="!isEditable"
        @click="deleteTable"
      >
        <span class="i-lucide-table-2 w-3.5 h-3.5 inline-block align-middle" />
      </button>
    </div>
  </BubbleMenu>
</template>
