<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  current: number
  total: number
}>()

const emit = defineEmits<{
  go: [page: number]
}>()

const items = computed(() => {
  const cur = props.current
  const total = props.total
  if (total <= 1) return []
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const result: (number | '...')[] = []

  if (cur <= 4) {
    for (let i = 1; i <= 4; i++) result.push(i)
    result.push('...')
    result.push(total - 1, total)
  } else if (cur >= total - 3) {
    result.push(1, 2)
    result.push('...')
    for (let i = total - 3; i <= total; i++) result.push(i)
  } else {
    result.push(1)
    result.push('...')
    result.push(cur - 1, cur, cur + 1)
    result.push('...')
    result.push(total)
  }

  return result
})
</script>

<template>
  <div v-if="total > 1" class="flex items-center justify-center gap-1 mt-3 text-xs">
    <button
      class="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
      :disabled="current <= 1"
      @click="emit('go', current - 1)"
    >
      <span class="i-lucide-chevron-left w-4 h-4 inline-block align-middle" />
    </button>
    <template v-for="(item, idx) in items" :key="idx">
      <span v-if="item === '...'" class="w-7 h-7 flex items-center justify-center text-gray-300"
        >…</span
      >
      <button
        v-else
        class="w-7 h-7 rounded"
        :class="item === current ? 'bg-blue-500 text-white' : 'hover:bg-gray-100 text-gray-600'"
        @click="emit('go', item)"
      >
        {{ item }}
      </button>
    </template>
    <button
      class="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
      :disabled="current >= total"
      @click="emit('go', current + 1)"
    >
      <span class="i-lucide-chevron-right w-4 h-4 inline-block align-middle" />
    </button>
  </div>
</template>
