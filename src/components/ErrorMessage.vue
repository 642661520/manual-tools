<script setup lang="ts">
defineProps<{
  message: string
}>()
</script>

<template>
  <p v-if="message" class="text-sm text-red-500 bg-red-50 px-3 py-2 rounded">{{ message }}</p>
</template>
