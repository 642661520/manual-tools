<script setup lang="ts">
import { computed } from 'vue'
import { useDialog } from '@/composables/useDialog'
import ModalDialog from '@/components/ModalDialog.vue'

const { dialogVisible, dialogState, dialogConfirm, dialogCancel } = useDialog()

const confirmDisabled = computed(() => {
  if (dialogState.type === 'danger') {
    return dialogState.inputValue !== dialogState.dangerPhrase
  }
  return false
})

function fillDangerPhrase() {
  dialogState.inputValue = dialogState.dangerPhrase
}
</script>

<template>
  <ModalDialog
    :visible="dialogVisible"
    :title="dialogState.title || '提示'"
    :confirm-text="
      dialogState.type === 'alert'
        ? '确定'
        : dialogState.type === 'prompt'
          ? '确认'
          : dialogState.type === 'danger'
            ? '我确认删除'
            : '确定'
    "
    :cancel-text="dialogState.type === 'alert' ? '' : '取消'"
    :confirm-variant="
      dialogState.type === 'danger'
        ? 'danger'
        : dialogState.type === 'confirm'
          ? 'danger'
          : 'primary'
    "
    :confirm-disabled="confirmDisabled"
    @close="dialogCancel"
    @confirm="dialogConfirm"
  >
    <div class="space-y-3">
      <p class="text-sm text-secondary whitespace-pre-wrap">
        {{ dialogState.message }}
      </p>
      <div v-if="dialogState.type === 'danger'">
        <p class="text-xs text-red-500 mb-1">请输入「{{ dialogState.dangerPhrase }}」以确认</p>
        <div class="flex gap-2">
          <input
            v-model="dialogState.inputValue"
            class="input text-sm flex-1"
            :placeholder="`请输入 ${dialogState.dangerPhrase}`"
            @keyup.enter="!confirmDisabled && dialogConfirm()"
          />
          <button
            class="btn-secondary text-xs whitespace-nowrap flex items-center gap-1"
            :disabled="dialogState.inputValue === dialogState.dangerPhrase"
            title="一键填入确认短语"
            @click="fillDangerPhrase"
          >
            <span class="i-lucide-sparkles w-3.5 h-3.5 inline-block align-middle" />
            一键填充
          </button>
        </div>
      </div>
      <input
        v-if="dialogState.type === 'prompt'"
        v-model="dialogState.inputValue"
        class="input text-sm"
        :placeholder="dialogState.placeholder || '请输入...'"
        @keyup.enter="dialogConfirm"
      />
    </div>
  </ModalDialog>
</template>
