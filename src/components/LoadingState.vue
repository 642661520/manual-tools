<script setup lang="ts">
defineProps<{
  message?: string
}>()
</script>

<template>
  <div class="flex items-center justify-center py-12 text-muted">
    {{ message || '加载中...' }}
  </div>
</template>
