import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { UserInfo } from '@shared/types'
import { login as apiLogin, getCurrentUser, updateProfile as apiUpdateProfile, changeUsername as apiChangeUsername, logout as apiLogout } from '@/api/endpoints/auth'
import { getMembers } from '@/api/endpoints/projects'
import { getStoredUser } from '@/utils/storage'
import { useProject } from './useProject'

const currentUser = ref<UserInfo | null>(getStoredUser())
const token = ref<string | null>(localStorage.getItem('auth_token'))
const currentProjectRole = ref<'pm' | 'writer' | 'viewer' | null>(null)

export function useAuth() {
  const router = useRouter()
  const isLoggedIn = computed(() => !!token.value && !!currentUser.value)
  const isAdmin = computed(() => currentUser.value?.role === 'admin')
  const isMember = computed(() => currentUser.value?.role === 'member')
  const isGuest = computed(() => currentUser.value?.role === 'guest')

  // 项目角色便捷计算
  const canManageProject = computed(() => isAdmin.value || currentProjectRole.value === 'pm')
  const canWriteContent = computed(() => isAdmin.value || currentProjectRole.value === 'pm' || currentProjectRole.value === 'writer')

  // 监听项目切换，自动获取当前用户在项目中的角色
  const { currentProjectId } = useProject()

  watch(currentProjectId, async (projectId) => {
    if (!projectId || !token.value) {
      setProjectRole(null)
      return
    }
    // admin 自动拥有所有项目权限
    if (currentUser.value?.role === 'admin') {
      setProjectRole('pm')
      return
    }
    // 查询成员列表确定项目角色
    try {
      const members = await getMembers(projectId)
      const me = members.find(m => m.id === currentUser.value?.id)
      setProjectRole(me?.projectRole || null)
    } catch {
      setProjectRole(null)
    }
  }, { immediate: true })

  /** 从 API 加载当前用户在当前项目中的角色 */
  function setProjectRole(role: 'pm' | 'writer' | 'viewer' | null) {
    currentProjectRole.value = role
  }

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

  async function updateUsername(username: string) {
    const data = await apiChangeUsername(username)
    token.value = data.token
    if (currentUser.value) {
      currentUser.value = { ...currentUser.value, username: data.username, usernameChanged: true }
    }
    localStorage.setItem('auth_token', data.token)
    localStorage.setItem('auth_user', JSON.stringify(currentUser.value))
  }

  function logout() {
    // 先调服务端递增 token_version 使 JWT 失效
    apiLogout().catch(() => {})
    token.value = null
    currentUser.value = null
    currentProjectRole.value = null
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    router.push('/login')
  }

  return { user: currentUser, token, isLoggedIn, isAdmin, isMember, isGuest, canManageProject, canWriteContent, currentProjectRole, setProjectRole, login, logout, refreshUser, updateProfile, updateUsername }
}