<script setup lang="ts"></script>

<template>
  <header
    class="flex items-center justify-between px-6 py-3 bg-surface border-b border-default flex-shrink-0"
  >
    <div class="flex items-center gap-4">
      <slot name="left" />
    </div>
    <div class="flex items-center gap-3">
      <slot name="right" />
    </div>
  </header>
</template>
