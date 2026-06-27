<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputRef = ref<HTMLInputElement | null>(null)

function openPicker() {
  inputRef.value?.click()
}

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- 隐藏的原生颜色选择器 -->
    <input
      ref="inputRef"
      type="color"
      :value="modelValue"
      class="absolute opacity-0 w-0 h-0 pointer-events-none"
      @input="onInput"
    />
    <!-- 自定义色块触发器 -->
    <button
      type="button"
      class="h-[42px] w-[42px] rounded-lg border-2 border-gray-200 cursor-pointer shadow-sm transition-all hover:scale-105 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 flex-shrink-0 box-border"
      :style="{ backgroundColor: modelValue }"
      v-tooltip="modelValue"
      @click="openPicker"
    />
    <!-- 十六进制值 -->
    <input
      type="text"
      :value="modelValue"
      class="w-20 h-[42px] px-3 py-2 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent box-border"
      maxlength="7"
      placeholder="#6366f1"
      @input="(e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value)"
    />
  </div>
</template>
