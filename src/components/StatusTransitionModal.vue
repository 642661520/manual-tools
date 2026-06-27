<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import ModalDialog from './ModalDialog.vue'
import StatusBadge from './StatusBadge.vue'

type SectionStatus = 'draft' | 'in_progress' | 'completed' | 'pending_review' | 'rejected' | 'approved'

interface TransitionOption {
  target: SectionStatus
  label: string
  description: string
  needNote: boolean
  noteLabel?: string
  variant: 'primary' | 'warning' | 'danger'
  direct?: boolean
}

const props = defineProps<{
  visible: boolean
  currentStatus: SectionStatus
  canManageProject: boolean
  isCurrentReviewer: boolean
  canWriteContent?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [payload: { target: string; note: string; direct?: boolean }]
}>()

const selected = ref<TransitionOption | null>(null)
const selectedIdx = ref<number | null>(null)
const note = ref('')
const error = ref('')

const availableTransitions = computed<TransitionOption[]>(() => {
  const s = props.currentStatus
  const result: TransitionOption[] = []

  if (!props.canManageProject) {
    // 编写者
    if (s === 'draft' || s === 'in_progress') {
      result.push({
        target: 'pending_review',
        label: '提交审核',
        description: '提交给项目管理员进行审核',
        needNote: false,
        variant: 'primary',
      })
    }
    if (s === 'rejected') {
      result.push({
        target: 'pending_review',
        label: '重新提交审核',
        description: '修改完成后重新提交项目管理员审核',
        needNote: false,
        variant: 'primary',
      })
    }
    return result
  }

  // PM
  if (s === 'pending_review' && props.isCurrentReviewer) {
    result.push({
      target: 'approved',
      label: '审核通过',
      description: '确认内容无误，通过审核',
      needNote: false,
      variant: 'primary',
    })
    result.push({
      target: 'rejected',
      label: '退回修改',
      description: '指出问题，退回给编写者修改',
      needNote: true,
      noteLabel: '退回理由',
      variant: 'warning',
    })
  }

  // 直接通过：非已审核 且 非(待审核+当前审核人)
  if (s !== 'approved' && !(s === 'pending_review' && props.isCurrentReviewer)) {
    result.push({
      target: 'approved',
      label: '直接通过',
      description: s === 'pending_review'
        ? '跳过当前审核环节，直接标记为已审核'
        : '跳过审核流程，直接标记为已审核',
      needNote: false,
      variant: 'primary',
      direct: true,
    })
  }

  // 已审核的需要修改
  if (s === 'approved') {
    result.push({
      target: 'in_progress',
      label: '需要修改',
      description: '将已审核的内容退回编写中状态',
      needNote: false,
      variant: 'warning',
    })
  }

  // 重置为未开始（任何非 draft 状态）
  if (s !== 'draft') {
    result.push({
      target: 'draft',
      label: '重置为未开始',
      description: '清除当前状态，回到未开始',
      needNote: false,
      variant: 'danger',
    })
  }

  return result
})

const confirmDisabled = computed(() => {
  if (!selected.value) return true
  if (selected.value.needNote && !note.value.trim()) return true
  return false
})

function selectOption(opt: TransitionOption, idx: number) {
  selected.value = opt
  selectedIdx.value = idx
  note.value = ''
  error.value = ''
}

function handleConfirm() {
  if (!selected.value) return
  if (selected.value.needNote && !note.value.trim()) {
    error.value = '请填写说明'
    return
  }
  emit('confirm', {
    target: selected.value.target,
    note: note.value.trim(),
    direct: selected.value.direct,
  })
}

function handleClose() {
  selected.value = null
  selectedIdx.value = null
  note.value = ''
  error.value = ''
  emit('close')
}

watch(() => props.visible, (val) => {
  if (val) {
    selected.value = null
    selectedIdx.value = null
    note.value = ''
    error.value = ''
  }
})

const variantSelected: Record<string, string> = {
  primary: 'border-blue-400 bg-blue-50',
  warning: 'border-orange-400 bg-orange-50',
  danger: 'border-red-400 bg-red-50',
}

const variantRadio: Record<string, string> = {
  primary: 'border-blue-500',
  warning: 'border-orange-500',
  danger: 'border-red-500',
}

const variantRadioFill: Record<string, string> = {
  primary: 'bg-blue-500',
  warning: 'bg-orange-500',
  danger: 'bg-red-500',
}
</script>

<template>
  <ModalDialog
    :visible="visible"
    title="变更小节状态"
    confirm-text="确认变更"
    cancel-text="取消"
    :confirm-disabled="confirmDisabled"
    :error="error"
    width-class="max-w-md"
    @close="handleClose"
    @confirm="handleConfirm"
  >
    <div class="space-y-4">
      <!-- 当前状态 -->
      <div class="flex items-center gap-2 text-sm">
        <span class="text-gray-500">当前状态：</span>
        <StatusBadge :status="currentStatus" />
      </div>

      <!-- 无可用操作 -->
      <div v-if="availableTransitions.length === 0" class="text-sm text-gray-400 text-center py-4">
        当前状态下没有可执行的操作
      </div>

      <!-- 可选目标状态 -->
      <div v-else class="space-y-2">
        <label class="label">目标状态</label>
        <button
          v-for="(opt, idx) in availableTransitions"
          :key="`${opt.target}-${idx}`"
          class="w-full text-left px-4 py-3 rounded-lg border transition-colors"
          :class="selectedIdx === idx
            ? variantSelected[opt.variant]
            : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300'"
          @click="selectOption(opt, idx)"
        >
          <div class="flex items-start gap-3">
            <!-- 单选圆圈 -->
            <span
              class="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors"
              :class="selectedIdx === idx
                ? variantRadio[opt.variant]
                : 'border-gray-300'"
            >
              <span
                v-if="selectedIdx === idx"
                class="w-2.5 h-2.5 rounded-full"
                :class="variantRadioFill[opt.variant]"
              />
            </span>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm" :class="selectedIdx === idx ? 'text-gray-900' : 'text-gray-700'">
                {{ opt.label }}
              </div>
              <p class="text-xs text-gray-500 mt-0.5">{{ opt.description }}</p>
            </div>
          </div>
        </button>
      </div>

      <!-- 退回理由输入 -->
      <div v-if="selected?.needNote">
        <label class="text-sm text-gray-500 mb-1 block">
          {{ selected.noteLabel || '说明' }}
          <span class="text-red-400">*</span>
        </label>
        <textarea
          v-model="note"
          class="textarea w-full"
          rows="3"
          placeholder="请填写具体原因..."
        />
      </div>
    </div>
  </ModalDialog>
</template>