<script setup lang="ts">
defineProps<{
  modelValue: boolean
  label: string
  description?: string
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <div
    class="flex items-start gap-2 cursor-pointer select-none"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <div
      class="w-4 h-4 rounded flex items-center justify-center border transition-colors flex-shrink-0 mt-0.5"
      :class="
        modelValue ? 'bg-[var(--c-accent)] border-[var(--c-accent)]' : 'border-input bg-surface'
      "
    >
      <span v-if="modelValue" class="i-lucide-check w-3 h-3 text-white" />
    </div>
    <div class="min-w-0">
      <span class="text-sm">{{ label }}</span>
      <p v-if="description" class="text-xs text-muted mt-0.5">{{ description }}</p>
    </div>
  </div>
</template>
