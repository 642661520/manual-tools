<script setup lang="ts">
defineProps<{
  message: string
}>()
</script>

<template>
  <p v-if="message" class="text-sm color-danger bg-danger px-3 py-2 rounded">
    {{ message }}
  </p>
</template>
