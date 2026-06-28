<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { getAuditLogs, type AuditLogEntry } from '@/api/endpoints/audit'
import SelectDropdown from '@/components/SelectDropdown.vue'
import type { SelectOption } from '@/components/SelectDropdown.vue'
import Paginator from '@/components/Paginator.vue'
import {
  AUDIT_ACTIONS,
  TARGET_TYPE_LABELS,
  ACTIONS_BY_TARGET,
  HIGH_RISK_ACTIONS,
  SECURITY_ACTIONS,
  type AuditAction,
} from '../../../shared/constants/audit-actions'

const rows = ref<AuditLogEntry[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = 30

// 两级筛选：操作对象 → 操作类型
const filterTargetType = ref<SelectOption['value']>(null)
const filterAction = ref<SelectOption['value']>(null)

const actionLabels: Record<string, string> = { ...AUDIT_ACTIONS }

const totalPages = computed(() => Math.ceil(total.value / pageSize))

// 操作对象选项（按目标对象分类）
const targetTypeOptions = computed<SelectOption[]>(() => [
  { value: null, label: '全部对象' },
  ...Object.entries(TARGET_TYPE_LABELS)
    .filter(([key]) => key in ACTIONS_BY_TARGET)
    .map(([value, label]) => ({ value, label })),
])

// 操作类型选项：未选对象时显示全部，选了对象后仅显示该对象下的操作
const actionOptions = computed<SelectOption[]>(() => {
  const base: SelectOption[] = [{ value: null, label: '全部操作' }]
  const target = filterTargetType.value ? String(filterTargetType.value) : null

  let actions: AuditAction[]
  if (target && target in ACTIONS_BY_TARGET) {
    actions = ACTIONS_BY_TARGET[target]
  } else {
    actions = Object.keys(AUDIT_ACTIONS) as AuditAction[]
  }

  base.push(...actions.map((v) => ({ value: v, label: actionLabels[v] || v })))
  return base
})

// 切换操作对象时重置操作类型筛选
watch(filterTargetType, () => {
  filterAction.value = null
  page.value = 1
  load()
})

function handleActionChange(value: SelectOption['value']) {
  filterAction.value = value
  page.value = 1
  load()
}

function actionClass(action: string): string {
  if (HIGH_RISK_ACTIONS.has(action as AuditAction)) return 'bg-red-100 text-red-700'
  if (SECURITY_ACTIONS.has(action as AuditAction)) return 'bg-orange-100 text-orange-700'
  return 'bg-gray-100 text-gray-700'
}

async function load() {
  loading.value = true
  try {
    const result = await getAuditLogs({
      targetType: filterTargetType.value ? String(filterTargetType.value) : undefined,
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
  <div class="flex flex-col" style="max-height: calc(100vh - 220px)">
    <div class="flex items-center gap-3 flex-shrink-0">
      <SelectDropdown
        :model-value="filterTargetType"
        :options="targetTypeOptions"
        placeholder="全部对象"
        width-class="w-32"
        @update:model-value="filterTargetType = $event"
      />
      <SelectDropdown
        :model-value="filterAction"
        :options="actionOptions"
        placeholder="全部操作"
        width-class="w-44"
        @update:model-value="handleActionChange"
      />
      <span class="text-xs text-gray-400">共 {{ total }} 条记录</span>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
      加载中...
    </div>
    <div
      v-else-if="rows.length === 0"
      class="flex-1 flex items-center justify-center text-gray-400 text-sm"
    >
      暂无操作记录
    </div>
    <div v-else class="flex-1 overflow-y-auto min-h-0">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="border-b border-gray-200 text-left text-xs text-gray-500">
            <th class="py-2 pr-4 sticky top-0 bg-white z-10">时间</th>
            <th class="py-2 pr-4 sticky top-0 bg-white z-10">操作人</th>
            <th class="py-2 pr-4 sticky top-0 bg-white z-10">操作对象</th>
            <th class="py-2 pr-4 sticky top-0 bg-white z-10">操作</th>
            <th class="py-2 sticky top-0 bg-white z-10">详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="border-b border-gray-100 hover:bg-gray-50">
            <td class="py-2 pr-4 text-gray-500 whitespace-nowrap">
              {{ new Date(r.createdAt).toLocaleString() }}
            </td>
            <td class="py-2 pr-4">{{ r.username }}</td>
            <td class="py-2 pr-4 text-xs text-gray-500">
              {{ TARGET_TYPE_LABELS[r.targetType] || r.targetType }}
            </td>
            <td class="py-2 pr-4">
              <span class="px-1.5 py-0.5 rounded text-xs" :class="actionClass(r.action)">
                {{ actionLabels[r.action] || r.action }}
              </span>
            </td>
            <td class="py-2 text-gray-600 text-xs max-w-xs truncate">
              {{ formatDetail(r.detail) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Paginator :current="page" :total="totalPages" class="flex-shrink-0 mt-3" @go="goPage" />
  </div>
</template>
