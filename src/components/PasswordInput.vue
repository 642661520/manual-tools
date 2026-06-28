<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const visible = ref(false)
</script>

<template>
  <div class="relative">
    <input
      :value="modelValue"
      class="input pr-8"
      :type="visible ? 'text' : 'password'"
      :placeholder="placeholder"
      @input="(e) => emit('update:modelValue', (e.target as HTMLInputElement).value)"
    />
    <button
      type="button"
      class="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-secondary"
      @click="visible = !visible"
    >
      <span
        :class="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        class="w-4 h-4 inline-block align-middle"
      />
    </button>
  </div>
</template>
