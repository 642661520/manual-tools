import { ref, reactive, readonly } from 'vue'

type DialogType = 'alert' | 'confirm' | 'danger' | 'prompt' | null

interface DialogState {
  type: DialogType
  title: string
  message: string
  placeholder: string
  inputValue: string
  dangerPhrase: string
}

// 模块级状态（全局单例）
const visible = ref(false)
const state = reactive<DialogState>({
  type: null,
  title: '',
  message: '',
  placeholder: '',
  inputValue: '',
  dangerPhrase: '',
})

let resolvePromise: ((value: unknown) => void) | null = null

function open(
  type: DialogType,
  title: string,
  message: string,
  opts?: { placeholder?: string; inputValue?: string },
): Promise<unknown> {
  return new Promise((resolve) => {
    resolvePromise = resolve
    state.type = type
    state.title = title
    state.message = message
    state.placeholder = opts?.placeholder || ''
    state.inputValue = opts?.inputValue || ''
    visible.value = true
  })
}

function close(result?: unknown) {
  visible.value = false
  if (resolvePromise) {
    resolvePromise(result)
    resolvePromise = null
  }
}

export function useDialog() {
  function alert(message: string): Promise<void> {
    return open('alert', '提示', message) as Promise<void>
  }

  function confirm(message: string): Promise<boolean> {
    return open('confirm', '确认', message) as Promise<boolean>
  }

  function prompt(
    message: string,
    opts?: { placeholder?: string; inputValue?: string },
  ): Promise<string | null> {
    return open('prompt', '输入', message, opts) as Promise<string | null>
  }

  function dangerConfirm(message: string): Promise<boolean> {
    state.dangerPhrase = '我确认删除'
    return open('danger', '危险操作', message) as Promise<boolean>
  }

  function onConfirm() {
    if (state.type === 'prompt') {
      close(state.inputValue || null)
    } else if (state.type === 'danger') {
      close(state.inputValue === state.dangerPhrase)
    } else if (state.type === 'confirm') {
      close(true)
    } else {
      close()
    }
  }

  function onCancel() {
    if (state.type === 'prompt') {
      close(null)
    } else if (state.type === 'confirm') {
      close(false)
    } else {
      close()
    }
  }

  return {
    dialogVisible: readonly(visible),
    dialogState: state,
    dialogConfirm: onConfirm,
    dialogCancel: onCancel,
    alert,
    confirm,
    prompt,
    dangerConfirm,
  }
}
