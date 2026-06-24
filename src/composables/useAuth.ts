import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import type { UserInfo } from '@shared/types'
import { login as apiLogin, getCurrentUser, updateProfile as apiUpdateProfile } from '@/api/endpoints/auth'

const currentUser = ref<UserInfo | null>(loadUser())
const token = ref<string | null>(localStorage.getItem('auth_token'))

function loadUser(): UserInfo | null {
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
    const data = await apiLogin(username, password)
    token.value = data.token
    currentUser.value = data.user
    localStorage.setItem('auth_token', data.token)
    localStorage.setItem('auth_user', JSON.stringify(data.user))
  }

  async function refreshUser() {
    if (!token.value) return
    try {
      const data = await getCurrentUser()
      currentUser.value = data.user
      localStorage.setItem('auth_user', JSON.stringify(data.user))
    } catch { /* ignore */ }
  }

  async function updateProfile(displayName: string) {
    const data = await apiUpdateProfile(displayName)
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
