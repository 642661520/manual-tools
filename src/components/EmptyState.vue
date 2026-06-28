<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  description?: string
}>()
</script>

<template>
  <div class="text-center py-16 text-muted">
    <div v-if="icon" :class="icon" class="text-4xl mb-3 mx-auto" />
    <div class="text-lg">
      {{ title }}
    </div>
    <div v-if="description" class="text-sm mt-1">
      {{ description }}
    </div>
  </div>
</template>
