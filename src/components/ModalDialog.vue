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
    <div class="bg-white rounded-xl shadow-xl w-full" :class="widthClass || 'max-w-md'">
      <!-- Header -->
      <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <button
          class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
          @click="emit('close')"
        >
          <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
        </button>
      </div>

      <!-- Body -->
      <div class="p-6">
        <slot />
      </div>

      <!-- Footer -->
      <div v-if="!hideFooter" class="px-6 py-4 border-t border-gray-200 flex flex-col gap-3">
        <ErrorMessage :message="error || ''" />
        <div class="flex justify-end gap-3">
          <button
            v-if="cancelText"
            class="btn-secondary"
            :disabled="loading"
            @click="emit('close')"
          >
            {{ cancelText }}
          </button>
          <button
            v-if="confirmText"
            class="btn-primary"
            :class="confirmVariant === 'danger' ? '!bg-red-600 hover:!bg-red-700' : ''"
            :disabled="loading || confirmDisabled"
            @click="emit('confirm')"
          >
            {{ loading ? '处理中...' : confirmText }}
          </button>
          <slot name="footer-actions" />
        </div>
      </div>
    </div>
  </div>
</template>
