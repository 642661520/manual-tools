import { ref, computed, watch } from 'vue'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'app_theme'

function getStoredTheme(): Theme {
  const val = localStorage.getItem(STORAGE_KEY)
  if (val === 'light' || val === 'dark' || val === 'system') return val
  return 'system'
}

function getSystemPreference(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// 模块级单例状态
const theme = ref<Theme>(getStoredTheme())
const systemPref = ref<'light' | 'dark'>(getSystemPreference())

const resolved = computed<'light' | 'dark'>(() => {
  if (theme.value === 'system') return systemPref.value
  return theme.value
})

let mediaQuery: MediaQueryList | null = null

function applyTheme(resolvedValue: 'light' | 'dark') {
  // 添加过渡 class 防止生硬切换
  document.documentElement.classList.add('transitioning')
  setTimeout(() => {
    document.documentElement.classList.remove('transitioning')
  }, 300)

  document.documentElement.classList.toggle('dark', resolvedValue === 'dark')
}

// 监听解析后的主题变化 → 应用到 DOM
watch(
  resolved,
  (val) => {
    applyTheme(val)
  },
  { immediate: true },
)

// 监听系统偏好变化
function setupSystemListener() {
  if (!mediaQuery) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', (e) => {
      systemPref.value = e.matches ? 'dark' : 'light'
    })
  }
}

// 初始设置
setupSystemListener()

export function useTheme() {
  function setTheme(t: Theme) {
    theme.value = t
    localStorage.setItem(STORAGE_KEY, t)
  }

  /** 获取下一个循环主题（用于单按钮切换） */
  function cycleTheme() {
    const order: Theme[] = ['light', 'dark', 'system']
    const idx = order.indexOf(theme.value)
    setTheme(order[(idx + 1) % order.length])
  }

  /** 主题标签文本 */
  const label = computed(() => {
    const map: Record<Theme, string> = {
      light: '浅色',
      dark: '深色',
      system: '跟随系统',
    }
    return map[theme.value]
  })

  /** 用于显示的图标（基于实际解析后的主题） */
  const icon = computed(() => {
    return resolved.value === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'
  })

  return {
    theme,
    resolved,
    setTheme,
    cycleTheme,
    label,
    icon,
  }
}
