<script setup lang="ts">
import ErrorMessage from './ErrorMessage.vue'

defineProps<{
  visible: boolean
  title: string
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'primary' | 'danger'
  confirmDisabled?: boolean
  loading?: boolean
  error?: string
  widthClass?: string
  hideFooter?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()
</script>

<template>
  <div v-if="visible" class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
    <div
      class="bg-surface rounded-xl shadow-xl w-full mx-3 sm:mx-auto max-w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[90vh] flex flex-col"
      :class="widthClass || ''"
    >
      <!-- Header -->
      <div
        class="px-4 sm:px-6 py-3 sm:py-4 border-b border-default flex items-center justify-between flex-shrink-0"
      >
        <h2 class="text-base sm:text-lg font-semibold truncate pr-2">
          {{ title }}
        </h2>
        <button
          type="button"
          class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover"
          @click="() => emit('close')"
        >
          <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
        </button>
      </div>

      <!-- Body -->
      <div class="p-4 sm:p-6 overflow-y-auto">
        <slot />
      </div>

      <!-- Footer -->
      <div
        v-if="!hideFooter"
        class="px-4 sm:px-6 py-3 sm:py-4 border-t border-default flex flex-col gap-3 flex-shrink-0"
      >
        <ErrorMessage :message="error || ''" />
        <div class="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
          <button
            v-if="cancelText"
            class="btn-secondary w-full sm:w-auto justify-center"
            :disabled="loading"
            @click="() => emit('close')"
          >
            {{ cancelText }}
          </button>
          <button
            v-if="confirmText"
            class="btn-primary w-full sm:w-auto justify-center"
            :class="confirmVariant === 'danger' ? '!bg-red-600 hover:!bg-red-700' : ''"
            :disabled="loading || confirmDisabled"
            @click="() => emit('confirm')"
          >
            {{ loading ? '处理中...' : confirmText }}
          </button>
          <slot name="footer-actions" />
        </div>
      </div>
    </div>
  </div>
</template>
