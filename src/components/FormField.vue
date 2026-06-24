<script setup lang="ts">
defineProps<{
  label: string
  required?: boolean
}>()
</script>

<template>
  <div>
    <label class="label">
      {{ label }}
      <span v-if="required" class="text-red-400"> *</span>
    </label>
    <slot />
  </div>
</template>
