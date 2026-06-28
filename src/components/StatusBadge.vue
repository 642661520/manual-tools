<script setup lang="ts">
defineProps<{
  status: 'draft' | 'in_progress' | 'completed' | 'pending_review' | 'rejected' | 'approved'
  variant?: 'badge' | 'text'
}>()

const labels: Record<string, string> = {
  draft: '未开始',
  in_progress: '编写中',
  completed: '已完成',
  pending_review: '待审核',
  rejected: '需修改',
  approved: '已审核',
}

const badgeClass: Record<string, string> = {
  draft: 'bg-hover text-secondary',
  in_progress: 'bg-blue-100 dark:bg-blue-900/30 color-accent dark:text-blue-300',
  completed: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  pending_review: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  rejected: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
}

const textClass: Record<string, string> = {
  draft: 'text-muted',
  in_progress: 'color-accent dark:text-blue-400',
  completed: 'text-green-500 dark:text-green-400',
  pending_review: 'text-yellow-500 dark:text-yellow-400',
  rejected: 'text-orange-500 dark:text-orange-400',
  approved: 'text-emerald-600 dark:text-emerald-400',
}
</script>

<template>
  <span v-if="variant === 'text'" class="text-xs" :class="textClass[status]">
    {{ labels[status] }}
  </span>
  <span v-else class="px-2 py-0.5 rounded-full text-xs font-medium" :class="badgeClass[status]">
    {{ labels[status] }}
  </span>
</template>
