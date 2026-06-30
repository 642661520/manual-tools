<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useProject } from '@/composables/useProject'
import { getTodos } from '@/api/endpoints/todos'
import type { TodoItem } from '@shared/types'
import LoadingState from '@/components/LoadingState.vue'

const router = useRouter()
const { currentProjectId } = useProject()
const todos = ref<TodoItem[]>([])
const loading = ref(true)

const statusGroups: { key: string; label: string; color: string; bg: string }[] = [
  {
    key: 'rejected',
    label: '需修改',
    color: 'text-orange-700 dark:text-orange-300',
    bg: 'bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-700',
  },
  {
    key: 'in_progress',
    label: '编写中',
    color: 'color-accent dark:text-blue-300',
    bg: 'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700',
  },
  { key: 'draft', label: '待开始', color: 'text-secondary', bg: 'bg-base border-default' },
  {
    key: 'pending_review',
    label: '待审核',
    color: 'text-yellow-700 dark:text-yellow-300',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-700',
  },
  {
    key: 'approved',
    label: '已完成',
    color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700',
  },
]

const groupedTodos = computed(() => {
  const groups: Record<string, TodoItem[]> = {}
  for (const t of todos.value) {
    const key = t.todoType === 'review' ? 'pending_review' : t.status
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  }
  return statusGroups
    .filter((g) => groups[g.key]?.length > 0)
    .map((g) => ({
      ...g,
      items: groups[g.key],
    }))
})

const totalCount = computed(() => todos.value.length)
const activeCount = computed(() => todos.value.filter((t) => t.status !== 'approved').length)

async function loadTodos() {
  loading.value = true
  try {
    todos.value = await getTodos(currentProjectId.value ?? undefined)
  } finally {
    loading.value = false
  }
}

function openEditor(t: TodoItem) {
  const query = t.sectionKey ? `?section=${encodeURIComponent(t.sectionKey)}` : ''
  router.push(`/features/${t.featureId}/edit${query}`)
}

onMounted(loadTodos)
watch(currentProjectId, loadTodos)
</script>

<template>
  <div class="h-full flex flex-col max-w-3xl mx-auto">
    <div class="flex-shrink-0 flex items-center justify-between mb-6 px-6 pt-6">
      <div>
        <h1 class="text-2xl font-bold">待办清单</h1>
        <p class="text-sm text-secondary mt-1">
          <template v-if="totalCount === 0"> 暂无待办任务 </template>
          <template v-else>
            {{ activeCount }} 项待处理，{{ totalCount - activeCount }} 项已完成
          </template>
        </p>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-6 pb-6">
      <LoadingState v-if="loading" />

      <template v-else-if="groupedTodos.length > 0">
        <div v-for="group in groupedTodos" :key="group.key" class="mb-6">
          <h2 class="text-sm font-semibold text-muted uppercase mb-2">
            {{ group.label }}
            <span class="font-normal text-muted ml-1">{{ group.items.length }}</span>
          </h2>
          <div class="space-y-1">
            <div
              v-for="t in group.items"
              :key="t.docId"
              class="flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer hover:shadow-sm transition-all"
              :class="group.bg"
              @click="() => openEditor(t)"
            >
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">
                  {{ t.featureTitle }} › {{ t.sectionTitle }}
                  <span
                    v-if="t.todoType === 'review'"
                    class="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-1.5 py-0.5 rounded ml-1.5 font-normal"
                    >审核</span
                  >
                </div>
                <div class="text-xs text-muted mt-0.5 font-mono">
                  {{ t.featureId }}/{{ t.sectionKey }}
                </div>
              </div>
              <span
                v-if="t.reviewNote"
                v-tooltip="t.reviewNote"
                class="text-xs text-secondary truncate max-w-[12rem] hidden sm:inline"
                >{{ t.reviewNote }}</span
              >
              <span class="i-lucide-arrow-right w-4 h-4 text-muted flex-shrink-0" />
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="!currentProjectId" class="text-center py-16">
        <span class="i-lucide-folder-open text-4xl text-muted mb-3 block mx-auto" />
        <p class="text-muted text-sm">请先加入项目</p>
        <p class="text-muted text-xs mt-1">联系管理员将您添加到项目成员中</p>
      </div>

      <div v-else class="text-center py-16">
        <span class="i-lucide-check-circle text-4xl text-muted mb-3 block mx-auto" />
        <p class="text-muted text-sm">没有待办任务</p>
      </div>
    </div>
  </div>
</template>
