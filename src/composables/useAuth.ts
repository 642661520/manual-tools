import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

interface User {
  id?: string
  username: string
  displayName: string
  role: 'pm' | 'ops' | 'guest'
  avatarUrl?: string
  feishuName?: string
  hasPassword?: boolean
  notifyEnabled?: boolean
  notifyPrefs?: Record<string, boolean>
}

const currentUser = ref<User | null>(loadUser())
const token = ref<string | null>(localStorage.getItem('auth_token'))

function loadUser(): User | null {
  try {
    const stored = localStorage.getItem('auth_user')
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function useAuth() {
  const router = useRouter()
  const isLoggedIn = computed(() => !!token.value && !!currentUser.value)
  const isPM = computed(() => currentUser.value?.role === 'pm')
  const isOps = computed(() => currentUser.value?.role === 'ops')
  const isGuest = computed(() => currentUser.value?.role === 'guest')

  async function login(username: string, password: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '登录失败')
    }
    const data = await res.json()
    token.value = data.token
    currentUser.value = data.user
    localStorage.setItem('auth_token', data.token)
    localStorage.setItem('auth_user', JSON.stringify(data.user))
  }

  async function refreshUser() {
    if (!token.value) return
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token.value}` },
      })
      if (res.ok) {
        const data = await res.json()
        currentUser.value = data.user
        localStorage.setItem('auth_user', JSON.stringify(data.user))
      }
    } catch { /* ignore */ }
  }

  async function updateProfile(displayName: string) {
    if (!token.value) throw new Error('未登录')
    const res = await fetch('/api/auth/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.value}`,
      },
      body: JSON.stringify({ displayName }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '更新失败')
    }
    const data = await res.json()
    // 更新本地令牌和用户信息
    token.value = data.token
    if (currentUser.value) {
      currentUser.value = { ...currentUser.value, displayName: data.displayName }
    }
    localStorage.setItem('auth_token', data.token)
    localStorage.setItem('auth_user', JSON.stringify(currentUser.value))
  }

  function logout() {
    token.value = null
    currentUser.value = null
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    router.push('/login')
  }

  return { user: currentUser, token, isLoggedIn, isPM, isOps, isGuest, login, logout, refreshUser, updateProfile }
}
