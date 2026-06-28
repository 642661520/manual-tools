<script setup lang="ts">
interface TabItem {
  key: string
  label: string
  icon: string
}

defineProps<{
  title: string
  tabs: TabItem[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <!-- 桌面端：侧边栏 -->
  <aside class="hidden md:flex w-48 bg-base border-r border-default flex-shrink-0 flex-col">
    <div class="px-4 py-3 text-xs text-muted font-medium">
      {{ title }}
    </div>
    <nav class="flex-1">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-colors"
        :class="
          modelValue === tab.key
            ? 'bg-surface color-accent border-r-2 border-blue-500'
            : 'text-secondary hover:bg-hover'
        "
        @click="() => emit('update:modelValue', tab.key)"
      >
        <span :class="tab.icon" class="w-4 h-4" />{{ tab.label }}
      </button>
    </nav>
  </aside>

  <!-- 移动端：顶部 Tab 水平滚动栏 -->
  <div class="md:hidden flex overflow-x-auto border-b border-default bg-base scrollbar-none">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      class="flex-shrink-0 px-3 sm:px-4 py-2.5 text-sm flex items-center gap-1.5 sm:gap-2 whitespace-nowrap transition-colors"
      :class="
        modelValue === tab.key
          ? 'color-accent border-b-2 border-blue-500 bg-surface'
          : 'text-secondary hover:bg-hover'
      "
      @click="() => emit('update:modelValue', tab.key)"
    >
      <span :class="tab.icon" class="w-4 h-4 flex-shrink-0" />{{ tab.label }}
    </button>
  </div>
</template>
