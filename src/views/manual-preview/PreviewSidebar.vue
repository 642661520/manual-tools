<script setup lang="ts">
import { ref, computed } from 'vue'
import type { SidebarNode, SidebarChapter, SidebarPart } from '@/composables/useSidebarTree'

const props = defineProps<{
  tree: SidebarNode[]
  activeChapter: number | null
  hasParts: boolean
}>()

const emit = defineEmits<{
  'select-chapter': [chNum: number]
  'select-section': [payload: { chNum: number; anchorId: string }]
  'select-cover': []
}>()

// 展开状态：part 默认展开，chapter 折叠
const expandedParts = ref<Set<string>>(new Set(props.tree.filter(isPart).map((p) => p.id)))
const expandedChapters = ref<Set<number>>(new Set())

function isPart(node: SidebarNode): node is SidebarPart {
  return node.type === 'part'
}

function togglePart(id: string) {
  if (expandedParts.value.has(id)) {
    expandedParts.value.delete(id)
  } else {
    expandedParts.value.add(id)
  }
}

function toggleChapter(chNum: number) {
  if (expandedChapters.value.has(chNum)) {
    expandedChapters.value.delete(chNum)
  } else {
    expandedChapters.value.add(chNum)
  }
  emit('select-chapter', chNum)
}

function onSectionClick(chNum: number, anchorId: string) {
  emit('select-chapter', chNum)
  if (!expandedChapters.value.has(chNum)) {
    expandedChapters.value.add(chNum)
  }
  // 延迟滚动，等 DOM 更新
  setTimeout(() => {
    const el = document.getElementById(anchorId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 100)
}

const totalChapters = computed(() => {
  let count = 0
  for (const node of props.tree) {
    if (isPart(node)) count += node.children.length
    else count++
  }
  return count
})
</script>

<template>
  <aside
    class="w-64 flex-shrink-0 overflow-y-auto border-r border-default bg-surface flex flex-col h-full"
  >
    <div class="px-3 py-3 border-b border-light">
      <span class="text-xs font-semibold text-muted uppercase">目录</span>
      <span class="text-xs text-muted ml-1">{{ totalChapters }} 章</span>
    </div>
    <nav class="flex-1 overflow-y-auto px-2 py-2">
      <!-- 概览 -->
      <button
        class="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors mb-1"
        :class="
          activeChapter === 0
            ? 'bg-active color-accent font-medium'
            : 'text-secondary hover:bg-hover'
        "
        @click="() => emit('select-cover')"
      >
        <span
          class="i-lucide-book-open w-4 h-4 inline-block align-middle flex-shrink-0"
          :class="activeChapter === 0 ? 'text-blue-400' : 'text-muted'"
        />
        <span>概览</span>
      </button>
      <div class="border-b border-light mb-2" />
      <template v-for="node in tree" :key="isPart(node) ? node.id : node.featureId">
        <!-- Part 节点 -->
        <div v-if="isPart(node)" class="mb-1">
          <button
            class="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-secondary hover:text-secondary rounded transition-colors"
            @click="() => togglePart((node as SidebarPart).id)"
          >
            <span
              :class="
                expandedParts.has((node as SidebarPart).id)
                  ? 'i-lucide-chevron-down'
                  : 'i-lucide-chevron-right'
              "
              class="w-3 h-3 inline-block align-middle flex-shrink-0 text-muted"
            />
            <span
              class="i-lucide-book-open w-3.5 h-3.5 inline-block align-middle flex-shrink-0 text-indigo-400"
            />
            <span class="truncate">{{ (node as SidebarPart).title }}</span>
          </button>
          <ul v-show="expandedParts.has((node as SidebarPart).id)" class="ml-4 mt-0.5 space-y-0.5">
            <li v-for="ch in (node as SidebarPart).children" :key="ch.featureId">
              <!-- Leaf chapter：无展开，点击直接跳转 -->
              <button
                v-if="ch.isLeaf"
                class="w-full flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors"
                :class="
                  activeChapter === ch.chNum
                    ? 'bg-active color-accent font-medium'
                    : 'text-secondary hover:bg-hover'
                "
                @click="() => emit('select-chapter', ch.chNum)"
              >
                <span class="w-3 h-3 flex-shrink-0" />
                <span class="text-muted font-mono w-5 text-right flex-shrink-0">{{
                  ch.chNum
                }}</span>
                <span
                  class="i-lucide-file-text w-3.5 h-3.5 inline-block align-middle flex-shrink-0"
                  :class="activeChapter === ch.chNum ? 'text-blue-400' : 'text-muted'"
                />
                <span class="truncate text-left">{{ ch.title }}</span>
              </button>
              <!-- 多小节：可展开 -->
              <template v-else>
                <button
                  class="w-full flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors"
                  :class="
                    activeChapter === ch.chNum
                      ? 'bg-active color-accent font-medium'
                      : 'text-secondary hover:bg-hover'
                  "
                  @click="() => toggleChapter(ch.chNum)"
                >
                  <span
                    :class="
                      expandedChapters.has(ch.chNum)
                        ? 'i-lucide-chevron-down'
                        : 'i-lucide-chevron-right'
                    "
                    class="w-3 h-3 inline-block align-middle flex-shrink-0 text-muted"
                  />
                  <span class="text-muted font-mono w-5 text-right flex-shrink-0">{{
                    ch.chNum
                  }}</span>
                  <span
                    class="i-lucide-file-text w-3.5 h-3.5 inline-block align-middle flex-shrink-0"
                    :class="activeChapter === ch.chNum ? 'text-blue-400' : 'text-muted'"
                  />
                  <span class="truncate text-left">{{ ch.title }}</span>
                </button>
                <ul v-show="expandedChapters.has(ch.chNum)" class="ml-5 mt-0.5 space-y-0">
                  <li v-for="(sec, i) in ch.sections" :key="sec.key">
                    <button
                      class="w-full flex items-center gap-1.5 px-2 py-0.5 text-xs transition-colors rounded"
                      :class="
                        activeChapter === ch.chNum
                          ? 'text-secondary hover:text-secondary hover:bg-hover'
                          : 'text-muted hover:text-secondary'
                      "
                      @click="() => onSectionClick(ch.chNum, sec.anchorId)"
                    >
                      <span
                        class="i-lucide-hash w-3 h-3 inline-block align-middle flex-shrink-0 text-muted"
                      />
                      <span class="truncate text-left"
                        >{{ ch.chNum }}.{{ i + 1 }} {{ sec.title }}</span
                      >
                    </button>
                  </li>
                </ul>
              </template>
            </li>
          </ul>
        </div>

        <!-- 无 Part 时的 Chapter 节点 -->
        <div v-else class="mb-0.5">
          <!-- Leaf：点击直接跳转 -->
          <button
            v-if="(node as SidebarChapter).isLeaf"
            class="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors"
            :class="
              activeChapter === (node as SidebarChapter).chNum
                ? 'bg-active color-accent font-medium'
                : 'text-secondary hover:bg-hover'
            "
            @click="() => emit('select-chapter', (node as SidebarChapter).chNum)"
          >
            <span class="w-3.5 h-3.5 flex-shrink-0" />
            <span class="text-muted font-mono text-xs w-6 text-right flex-shrink-0">{{
              (node as SidebarChapter).chNum
            }}</span>
            <span class="truncate text-left">{{ (node as SidebarChapter).title }}</span>
          </button>
          <!-- 多小节：可展开 -->
          <template v-else>
            <button
              class="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors"
              :class="
                activeChapter === (node as SidebarChapter).chNum
                  ? 'bg-active color-accent font-medium'
                  : 'text-secondary hover:bg-hover'
              "
              @click="() => toggleChapter((node as SidebarChapter).chNum)"
            >
              <span
                :class="
                  expandedChapters.has((node as SidebarChapter).chNum)
                    ? 'i-lucide-chevron-down'
                    : 'i-lucide-chevron-right'
                "
                class="w-3.5 h-3.5 inline-block align-middle flex-shrink-0 text-muted"
              />
              <span class="text-muted font-mono text-xs w-6 text-right flex-shrink-0">{{
                (node as SidebarChapter).chNum
              }}</span>
              <span class="truncate text-left">{{ (node as SidebarChapter).title }}</span>
            </button>
            <ul
              v-show="expandedChapters.has((node as SidebarChapter).chNum)"
              class="ml-6 mt-0.5 space-y-0"
            >
              <li v-for="sec in (node as SidebarChapter).sections" :key="sec.key">
                <button
                  class="w-full flex items-center gap-1.5 px-2 py-0.5 text-xs transition-colors rounded"
                  :class="
                    activeChapter === (node as SidebarChapter).chNum
                      ? 'text-secondary hover:text-secondary hover:bg-hover'
                      : 'text-muted hover:text-secondary'
                  "
                  @click="() => onSectionClick((node as SidebarChapter).chNum, sec.anchorId)"
                >
                  <span
                    class="i-lucide-hash w-3 h-3 inline-block align-middle flex-shrink-0 text-muted"
                  />
                  <span class="truncate text-left"
                    >{{ (node as SidebarChapter).chNum }}.{{
                      (node as SidebarChapter).sections.indexOf(sec) + 1
                    }}
                    {{ sec.title }}</span
                  >
                </button>
              </li>
            </ul>
          </template>
        </div>
      </template>

      <div v-if="tree.length === 0" class="text-xs text-muted text-center py-4">暂无可预览的章</div>
    </nav>
  </aside>
</template>
