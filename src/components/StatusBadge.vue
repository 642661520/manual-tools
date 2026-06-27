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
  draft: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  pending_review: 'bg-yellow-100 text-yellow-700',
  rejected: 'bg-orange-100 text-orange-700',
  approved: 'bg-emerald-100 text-emerald-700',
}

const textClass: Record<string, string> = {
  draft: 'text-gray-400',
  in_progress: 'text-blue-500',
  completed: 'text-green-500',
  pending_review: 'text-yellow-500',
  rejected: 'text-orange-500',
  approved: 'text-emerald-600',
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
