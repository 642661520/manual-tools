// 全局错误提示 — 模块级单例，任意组件可触发
import { ref } from 'vue'

interface ToastItem {
  id: number
  message: string
  timer?: ReturnType<typeof setTimeout>
}

const MAX_TOASTS = 5
let nextId = 0
export const toasts = ref<ToastItem[]>([])

export function showErrorToast(message: string) {
  // 去重：相同消息复用已有 toast，重置计时器
  const existing = toasts.value.find((t) => t.message === message)
  if (existing) {
    if (existing.timer) clearTimeout(existing.timer)
    existing.timer = setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== existing.id)
    }, 6000)
    return
  }

  const id = ++nextId
  const toast: ToastItem = { id, message }
  toast.timer = setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 6000)
  toasts.value.push(toast)

  // 超出上限时移除最早的一条
  if (toasts.value.length > MAX_TOASTS) {
    const oldest = toasts.value.shift()
    if (oldest?.timer) clearTimeout(oldest.timer)
  }
}
