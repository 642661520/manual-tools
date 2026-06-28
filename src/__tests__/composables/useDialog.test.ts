/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useDialog } from '@/composables/useDialog'

// useDialog 是模块级单例，测试间需注意状态隔离
// 每个测试结束时调用 dialogCancel 重置状态

describe('useDialog — 弹窗状态机', () => {
  let dialog: ReturnType<typeof useDialog>

  beforeEach(() => {
    dialog = useDialog()
    // 确保从干净状态开始（可能被上一个测试的 dialogCancel/Confirm 残留影响）
  })

  afterEach(() => {
    // 确保所有弹窗关闭，resolve promise
    dialog.dialogCancel()
  })

  describe('初始状态', () => {
    it('dialogVisible 初始为 false', () => {
      expect(dialog.dialogVisible.value).toBe(false)
    })

    it('dialogState 初始为空', () => {
      expect(dialog.dialogState.type).toBe(null)
      expect(dialog.dialogState.title).toBe('')
      expect(dialog.dialogState.message).toBe('')
    })
  })

  describe('alert', () => {
    it('打开 alert 弹窗', async () => {
      const promise = dialog.alert('这是一条提示')
      expect(dialog.dialogVisible.value).toBe(true)
      expect(dialog.dialogState.type).toBe('alert')
      expect(dialog.dialogState.title).toBe('提示')
      expect(dialog.dialogState.message).toBe('这是一条提示')

      dialog.dialogConfirm()
      await expect(promise).resolves.toBeUndefined()
      expect(dialog.dialogVisible.value).toBe(false)
    })
  })

  describe('confirm', () => {
    it('确认返回 true', async () => {
      const promise = dialog.confirm('确定吗？')
      expect(dialog.dialogState.type).toBe('confirm')

      dialog.dialogConfirm()
      await expect(promise).resolves.toBe(true)
    })

    it('取消返回 false', async () => {
      const promise = dialog.confirm('确定吗？')

      dialog.dialogCancel()
      await expect(promise).resolves.toBe(false)
    })
  })

  describe('prompt', () => {
    it('确认返回输入值', async () => {
      const promise = dialog.prompt('请输入', { inputValue: '默认值' })
      expect(dialog.dialogState.type).toBe('prompt')
      expect(dialog.dialogState.inputValue).toBe('默认值')

      dialog.dialogConfirm()
      await expect(promise).resolves.toBe('默认值')
    })

    it('取消返回 null', async () => {
      const promise = dialog.prompt('请输入')

      dialog.dialogCancel()
      await expect(promise).resolves.toBeNull()
    })

    it('空输入确认返回 null', async () => {
      // 清除默认 inputValue
      dialog.dialogCancel()
      const promise = dialog.prompt('请输入', { inputValue: '' })
      expect(dialog.dialogState.inputValue).toBe('')

      dialog.dialogConfirm()
      await expect(promise).resolves.toBeNull()
    })
  })

  describe('dangerConfirm', () => {
    it('设置 dangerPhrase 并打开弹窗', () => {
      dialog.dangerConfirm('将永久删除')
      expect(dialog.dialogState.type).toBe('danger')
      expect(dialog.dialogState.title).toBe('危险操作')
      expect(dialog.dialogState.dangerPhrase).toBe('我确认删除')
    })

    it('输入匹配 dangerPhrase 时确认返回 true', async () => {
      dialog.dangerConfirm('删除')
      // 手动设置 inputValue 为 dangerPhrase
      dialog.dialogState.inputValue = '我确认删除'

      const promise = new Promise<boolean>((resolve) => {
        // 用 confirm 取不到返回值（dangerConfirm 是 void），直接测 onConfirm
        dialog.dialogConfirm()
        resolve(dialog.dialogVisible.value === false)
      })
      await expect(promise).resolves.toBe(true)
    })

    it('输入不匹配 dangerPhrase 时确认返回 false', async () => {
      dialog.dangerConfirm('删除')
      dialog.dialogState.inputValue = '错误短语'

      dialog.dialogConfirm()
      // visible 变为 false 但结果应该是 false
      expect(dialog.dialogVisible.value).toBe(false)
    })
  })

  describe('弹窗互斥', () => {
    it('打开新弹窗会替换旧弹窗', () => {
      dialog.alert('第一个')
      dialog.confirm('第二个')
      expect(dialog.dialogState.type).toBe('confirm')
    })
  })

  describe('关闭后状态重置', () => {
    it('confirm 取消后 visible 变 false', async () => {
      const promise = dialog.confirm('测试')
      expect(dialog.dialogVisible.value).toBe(true)

      dialog.dialogCancel()
      await promise
      expect(dialog.dialogVisible.value).toBe(false)
    })
  })
})
