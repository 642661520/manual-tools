<script setup lang="ts">
defineProps<{
  avatarUrl?: string | null
  name?: string | null
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg'
}>()

const sizeClasses: Record<string, { outer: string; text: string }> = {
  '2xs': { outer: 'w-5 h-5 text-[10px]', text: '' },
  xs: { outer: 'w-4 h-4 text-[8px]', text: '' },
  sm: { outer: 'w-7 h-7 text-xs', text: '' },
  md: { outer: 'w-8 h-8 text-sm', text: '' },
  lg: { outer: 'w-12 h-12 text-lg', text: '' },
}
</script>

<template>
  <img
    v-if="avatarUrl"
    :src="avatarUrl"
    :class="[sizeClasses[size || 'md'].outer, 'rounded-full flex-shrink-0']"
    alt=""
  />
  <span
    v-else
    :class="[
      sizeClasses[size || 'md'].outer,
      'rounded-full bg-active flex items-center justify-center color-accent font-semibold flex-shrink-0',
    ]"
    >{{ (name || '?')[0] }}</span
  >
</template>
