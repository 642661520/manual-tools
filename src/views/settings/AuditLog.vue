<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { getAuditLogs, type AuditLogEntry } from '@/api/endpoints/audit'
import SelectDropdown from '@/components/SelectDropdown.vue'
import type { SelectOption } from '@/components/SelectDropdown.vue'
import Paginator from '@/components/Paginator.vue'

const rows = ref<AuditLogEntry[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1) // 1-based for Paginator
const pageSize = 30
const filterAction = ref<SelectOption['value']>(null)

const actionLabels: Record<string, string> = {
  'catalog.publish': '发布手册',
  'catalog.delete': '删除手册',
  'user.role_change': '角色变更',
}

const totalPages = computed(() => Math.ceil(total.value / pageSize))

const actionOptions = computed<SelectOption[]>(() => [
  { value: null, label: '全部操作' },
  ...Object.entries(actionLabels).map(([value, label]) => ({ value, label })),
])

async function load() {
  loading.value = true
  try {
    const result = await getAuditLogs({
      action: filterAction.value ? String(filterAction.value) : undefined,
      limit: pageSize,
      offset: (page.value - 1) * pageSize,
    })
    rows.value = result.rows
    total.value = result.total
  } catch {
    /* ignore */
  } finally {
    loading.value = false
  }
}

function handleFilterChange(value: SelectOption['value']) {
  filterAction.value = value
  page.value = 1
  load()
}

function goPage(p: number) {
  page.value = p
  load()
}

function formatDetail(detail: string): string {
  try {
    const obj = JSON.parse(detail)
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
  } catch {
    return detail || '-'
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <SelectDropdown
        :model-value="filterAction"
        :options="actionOptions"
        placeholder="全部操作"
        width-class="w-40"
        @update:model-value="handleFilterChange"
      />
      <span class="text-xs text-gray-400">共 {{ total }} 条记录</span>
    </div>

    <div v-if="loading" class="text-center py-8 text-gray-400 text-sm">加载中...</div>
    <div v-else-if="rows.length === 0" class="text-center py-8 text-gray-400 text-sm">
      暂无操作记录
    </div>
    <table v-else class="w-full text-sm border-collapse">
      <thead>
        <tr class="border-b border-gray-200 text-left text-xs text-gray-500">
          <th class="py-2 pr-4">时间</th>
          <th class="py-2 pr-4">操作人</th>
          <th class="py-2 pr-4">操作</th>
          <th class="py-2">详情</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id" class="border-b border-gray-100 hover:bg-gray-50">
          <td class="py-2 pr-4 text-gray-500 whitespace-nowrap">
            {{ new Date(r.createdAt).toLocaleString() }}
          </td>
          <td class="py-2 pr-4">{{ r.username }}</td>
          <td class="py-2 pr-4">
            <span class="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
              {{ actionLabels[r.action] || r.action }}
            </span>
          </td>
          <td class="py-2 text-gray-600 text-xs max-w-xs truncate">{{ formatDetail(r.detail) }}</td>
        </tr>
      </tbody>
    </table>

    <Paginator :current="page" :total="totalPages" @go="goPage" />
  </div>
</template>
