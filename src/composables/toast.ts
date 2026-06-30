// 全局提示 — 模块级单例，任意组件可触发
import { ref } from 'vue'

export type ToastType = 'error' | 'success'

interface ToastItem {
  id: number
  type: ToastType
  message: string
  timer?: ReturnType<typeof setTimeout>
}

const MAX_TOASTS = 5
let nextId = 0
export const toasts = ref<ToastItem[]>([])

function addToast(type: ToastType, message: string, duration: number) {
  // 去重：同类型相同消息复用已有 toast，重置计时器
  const existing = toasts.value.find((t) => t.type === type && t.message === message)
  if (existing) {
    if (existing.timer) clearTimeout(existing.timer)
    existing.timer = setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== existing.id)
    }, duration)
    return
  }

  const id = ++nextId
  const toast: ToastItem = { id, type, message }
  toast.timer = setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, duration)
  toasts.value.push(toast)

  // 超出上限时移除最早的一条
  if (toasts.value.length > MAX_TOASTS) {
    const oldest = toasts.value.shift()
    if (oldest?.timer) clearTimeout(oldest.timer)
  }
}

export function showErrorToast(message: string) {
  addToast('error', message, 6000)
}

export function showSuccessToast(message: string) {
  addToast('success', message, 3000)
}
