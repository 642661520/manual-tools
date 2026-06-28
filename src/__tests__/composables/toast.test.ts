/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toasts, showErrorToast } from '@/composables/toast'

describe('showErrorToast', () => {
  beforeEach(() => {
    // 清空 toast 列表和 ID 计数器（通过清空数组 + 重置 ref）
    toasts.value = []
  })

  it('应添加 toast 到列表', () => {
    showErrorToast('错误信息')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('错误信息')
    expect(toasts.value[0].id).toBeGreaterThan(0)
  })

  it('相同消息应去重（复用已有 toast）', () => {
    showErrorToast('重复错误')
    showErrorToast('重复错误')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('重复错误')
  })

  it('不同消息应分别添加', () => {
    showErrorToast('错误 A')
    showErrorToast('错误 B')
    showErrorToast('错误 C')
    expect(toasts.value).toHaveLength(3)
    expect(toasts.value.map((t) => t.message)).toEqual(['错误 A', '错误 B', '错误 C'])
  })

  it('超过上限 5 条时应移除最早的 toast', () => {
    for (let i = 1; i <= 7; i++) {
      showErrorToast(`错误 ${i}`)
    }
    expect(toasts.value).toHaveLength(5)
    // 最早的 "错误 1" 和 "错误 2" 应被移除
    expect(toasts.value[0].message).toBe('错误 3')
    expect(toasts.value[4].message).toBe('错误 7')
  })

  it('去重不会触发上限淘汰', () => {
    // 先填满 5 条不同消息
    for (let i = 1; i <= 5; i++) {
      showErrorToast(`消息 ${i}`)
    }
    expect(toasts.value).toHaveLength(5)

    // 重复第 5 条不新增，不淘汰
    showErrorToast('消息 5')
    expect(toasts.value).toHaveLength(5)
    expect(toasts.value[0].message).toBe('消息 1') // 第一条未被淘汰
  })

  it('6 秒后自动移除 toast', async () => {
    vi.useFakeTimers()

    showErrorToast('自动消失')
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(6000)
    expect(toasts.value).toHaveLength(0)

    vi.useRealTimers()
  })

  it('去重时重置计时器', async () => {
    vi.useFakeTimers()

    showErrorToast('重复')
    vi.advanceTimersByTime(3000) // 3 秒后

    showErrorToast('重复') // 去重，重置计时器
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(3000) // 距离第二次调用仅 3 秒，不应消失
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(3000) // 再过 3 秒（共 6 秒），应消失
    expect(toasts.value).toHaveLength(0)

    vi.useRealTimers()
  })

  it('溢出淘汰时清除被淘汰 toast 的计时器', () => {
    vi.useFakeTimers()

    // 添加 6 条不同消息，第一条的计时器应被清除
    showErrorToast('淘汰我')
    const firstId = toasts.value[0].id

    for (let i = 2; i <= 6; i++) {
      showErrorToast(`消息 ${i}`)
    }

    // 第一条已被淘汰
    expect(toasts.value.find((t) => t.id === firstId)).toBeUndefined()

    // 6 秒后，剩余 5 条不应包括它
    vi.advanceTimersByTime(6000)
    expect(toasts.value).toHaveLength(0)

    vi.useRealTimers()
  })
})
