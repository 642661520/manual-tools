<script setup lang="ts">
defineProps<{
  message?: string
}>()
</script>

<template>
  <div class="flex items-center justify-center py-12 text-gray-400">
    {{ message || '加载中...' }}
  </div>
</template>
