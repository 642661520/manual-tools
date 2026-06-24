<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import ModalDialog from '@/components/ModalDialog.vue'
import FormField from '@/components/FormField.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'

const { user, isGuest, logout, refreshUser, token, updateProfile } = useAuth()
const { confirm } = useDialog()

async function handleLogout() {
  if (!await confirm('确定退出登录？')) return
  logout()
}

const feishuBound = ref(false)
const feishuName = ref('')
const feishuAvatar = ref('')
const feishuError = ref('')

// 通知偏好
const notifyEnabled = ref(true)
const notifyPrefs = ref({
  assign: true,
  review: true,
  project: true,
  status: true,
})
const notifySaving = ref(false)

function loadNotifyPrefs() {
  if (!user.value) return
  notifyEnabled.value = user.value.notifyEnabled ?? true
  notifyPrefs.value = {
    assign: user.value.notifyPrefs?.assign ?? true,
    review: user.value.notifyPrefs?.review ?? true,
    project: user.value.notifyPrefs?.project ?? true,
    status: user.value.notifyPrefs?.status ?? true,
  }
}

async function saveNotifyPrefs() {
  notifySaving.value = true
  try {
    const res = await fetch('/api/auth/me/notify', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
      },
      body: JSON.stringify({
        notifyEnabled: notifyEnabled.value ? 1 : 0,
        notifyPrefs: notifyPrefs.value,
      }),
    })
    if (res.ok) {
      if (user.value) {
        user.value.notifyEnabled = notifyEnabled.value
        user.value.notifyPrefs = { ...notifyPrefs.value }
      }
    }
  } catch { /* ignore */ }
  finally { notifySaving.value = false }
}

const notifyLabels: { key: 'assign' | 'review' | 'project' | 'status'; label: string }[] = [
  { key: 'assign', label: '任务指派与移除' },
  { key: 'review', label: '审核相关（提交/通过/退回）' },
  { key: 'project', label: '项目与角色变更' },
  { key: 'status', label: '状态重置' },
]

async function loadFeishuBinding() {
  try {
    const res = await fetch('/api/auth/me/feishu-binding', {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
    })
    if (res.ok) {
      const data = await res.json()
      feishuBound.value = data.bound
      feishuName.value = data.name || ''
      feishuAvatar.value = data.avatarUrl || ''
    }
  } catch { /* ignore */ }
}

async function bindFeishu() {
  feishuError.value = ''
  try {
    const res = await fetch('/api/auth/feishu/bind-url', {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
    })
    if (!res.ok) { feishuError.value = '获取绑定链接失败'; return }
    const { url } = await res.json()

    const width = 600; const height = 700
    const left = window.screenX + (window.innerWidth - width) / 2
    const top = window.screenY + (window.innerHeight - height) / 2
    const popup = window.open(url, 'feishu-bind', `width=${width},height=${height},left=${left},top=${top}`)

    if (!popup) { feishuError.value = '弹出窗口被拦截，请允许弹出窗口'; return }

    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'feishu-bound') {
        window.removeEventListener('message', messageHandler)
        loadFeishuBinding()
      }
    }
    window.addEventListener('message', messageHandler)

    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer)
        loadFeishuBinding()
      }
    }, 500)
  } catch (e: unknown) {
    feishuError.value = e instanceof Error ? e.message : '绑定失败'
  }
}

async function unbindFeishu() {
  if (!await confirm('确定解除飞书绑定？')) return
  try {
    await fetch('/api/auth/me/feishu-binding', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
    })
    feishuBound.value = false
    feishuName.value = ''
    feishuAvatar.value = ''
  } catch { /* ignore */ }
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = { pm: '产品', ops: '运维人员', guest: '游客' }
  return labels[role] || role
}

// 编辑显示名称
const editingDisplayName = ref(false)
const newDisplayName = ref('')
const profileError = ref('')
const savingProfile = ref(false)

function startEditDisplayName() {
  newDisplayName.value = user.value?.displayName || ''
  profileError.value = ''
  editingDisplayName.value = true
}

function cancelEditDisplayName() {
  editingDisplayName.value = false
  profileError.value = ''
}

async function saveDisplayName() {
  const name = newDisplayName.value.trim()
  if (!name) {
    profileError.value = '显示名称不能为空'
    return
  }
  if (name.length > 64) {
    profileError.value = '显示名称不能超过64个字符'
    return
  }
  savingProfile.value = true
  profileError.value = ''
  try {
    await updateProfile(name)
    editingDisplayName.value = false
  } catch (e: unknown) {
    profileError.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    savingProfile.value = false
  }
}

// 修改密码
const hasPassword = computed(() => user.value?.hasPassword ?? true)
const showChangePassword = ref(false)
const changePasswordError = ref('')
const changePasswordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})
const showPw = ref({ current: false, new: false, confirm: false })

function validatePassword(password: string): string | null {
  if (!password) return '请输入新密码'
  if (password.length < 8) return '密码不能少于8位'
  if (password.length > 128) return '密码不能超过128位'

  let categories = 0
  if (/[A-Z]/.test(password)) categories++
  if (/[a-z]/.test(password)) categories++
  if (/[0-9]/.test(password)) categories++
  if (/[^A-Za-z0-9]/.test(password)) categories++

  if (categories < 3) return '密码需包含大写字母、小写字母、数字、特殊字符中至少3种'
  return null
}

function openChangePassword() {
  changePasswordError.value = ''
  changePasswordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  showPw.value = { current: false, new: false, confirm: false }
  showChangePassword.value = true
}

async function submitChangePassword() {
  changePasswordError.value = ''
  const { currentPassword, newPassword, confirmPassword } = changePasswordForm.value

  const pwError = validatePassword(newPassword)
  if (pwError) {
    changePasswordError.value = pwError
    return
  }
  if (newPassword !== confirmPassword) {
    changePasswordError.value = '两次输入的密码不一致'
    return
  }
  if (hasPassword.value && !currentPassword) {
    changePasswordError.value = '请输入当前密码'
    return
  }

  try {
    const res = await fetch('/api/auth/me/password', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
      },
      body: JSON.stringify({
        currentPassword: hasPassword.value ? currentPassword : undefined,
        newPassword,
      }),
    })
    if (!res.ok) {
      const body = await res.json()
      changePasswordError.value = body.error || '修改失败'
      return
    }
    const data = await res.json()
    // 更新令牌（密码修改后 token_version 已递增，旧令牌失效）
    token.value = data.token
    localStorage.setItem('auth_token', data.token)
    showChangePassword.value = false
    await refreshUser()
  } catch (e: unknown) {
    changePasswordError.value = e instanceof Error ? e.message : '网络错误，修改失败'
  }
}

onMounted(() => {
  loadFeishuBinding()
  loadNotifyPrefs()
})
</script>

<template>
  <div class="p-6 max-w-2xl mx-auto h-full overflow-y-auto">
    <h1 class="text-2xl font-bold mb-6">个人中心</h1>

    <!-- 游客权限提示 -->
    <div v-if="isGuest" class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
      <h2 class="font-semibold text-amber-800 text-sm flex items-center gap-2">
        <span class="i-lucide-alert-triangle w-4 h-4 inline-block align-middle" />账号待授权
      </h2>
      <p class="text-sm text-amber-600 mt-1">
        您的账号尚未获得操作权限。请联系管理员将您的角色从「游客」升级为「运维人员」或「产品」。
      </p>
    </div>

    <!-- 当前用户 -->
    <div class="card mb-6">
      <h2 class="text-sm font-semibold text-gray-500 mb-3">个人信息</h2>
      <div class="flex items-center gap-4">
        <img
          v-if="feishuBound && feishuAvatar"
          :src="feishuAvatar"
          class="w-12 h-12 rounded-full"
          alt=""
        />
        <div
          v-else
          class="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0"
        >
          <span class="text-blue-500 text-lg font-semibold">{{ (user?.displayName || user?.username || '?')[0] }}</span>
        </div>
        <div class="flex-1">
          <!-- 显示名称（可编辑） -->
          <div v-if="editingDisplayName" class="flex items-center gap-2 mb-0.5">
            <input
              v-model="newDisplayName"
              class="input text-sm py-1 flex-1"
              maxlength="64"
              :disabled="savingProfile"
              @keyup.enter="saveDisplayName"
              @keyup.escape="cancelEditDisplayName"
            />
            <button class="btn-primary text-xs px-2 py-1" :disabled="savingProfile" @click="saveDisplayName">
              {{ savingProfile ? '保存中…' : '保存' }}
            </button>
            <button class="btn-secondary text-xs px-2 py-1" :disabled="savingProfile" @click="cancelEditDisplayName">取消</button>
          </div>
          <div v-else class="font-medium flex items-center gap-1">
            {{ user?.displayName }}
            <button class="text-gray-400 hover:text-blue-500" title="编辑显示名称" @click="startEditDisplayName">
              <span class="i-lucide-pencil w-3.5 h-3.5 inline-block align-middle" />
            </button>
          </div>
          <div v-if="profileError" class="text-red-500 text-xs mt-0.5">{{ profileError }}</div>
          <div class="text-sm text-gray-500">
            {{ roleLabel(user?.role || '') }}
            <span v-if="feishuBound" class="text-green-600 ml-2 text-xs">已绑定飞书</span>
          </div>
        </div>
        <button class="btn-secondary text-sm" @click="openChangePassword">修改密码</button>
        <button class="btn-secondary text-sm" @click="handleLogout">退出登录</button>
      </div>
    </div>

    <!-- 通知偏好 -->
    <div class="card mb-6">
      <h2 class="text-sm font-semibold text-gray-500 mb-3">通知偏好</h2>
      <p class="text-xs text-gray-400 mb-4">绑定飞书后可接收通知。关闭后不再收到对应类型的飞书消息。</p>

      <!-- 全局开关 -->
      <label class="flex items-center justify-between py-2 cursor-pointer">
        <span class="text-sm">接收飞书通知</span>
        <button
          class="relative w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0"
          :class="notifyEnabled ? 'bg-blue-500' : 'bg-gray-300'"
          @click="notifyEnabled = !notifyEnabled; saveNotifyPrefs()"
        >
          <span class="absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200"
            :class="notifyEnabled ? 'translate-x-4.5' : ''"
          />
        </button>
      </label>

      <!-- 分类开关 -->
      <div class="border-t border-gray-100 mt-3 pt-3 space-y-2" :class="{ 'opacity-50 pointer-events-none': !notifyEnabled }">
        <label v-for="item in notifyLabels" :key="item.key" class="flex items-center justify-between py-1.5 cursor-pointer">
          <span class="text-sm text-gray-600">{{ item.label }}</span>
          <button
            class="relative w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0"
            :class="notifyPrefs[item.key] ? 'bg-blue-500' : 'bg-gray-300'"
            @click="notifyPrefs[item.key] = !notifyPrefs[item.key]; saveNotifyPrefs()"
          >
            <span class="absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200"
              :class="notifyPrefs[item.key] ? 'translate-x-4.5' : ''"
            />
          </button>
        </label>
      </div>
    </div>

    <!-- 飞书账号绑定 -->
    <div class="card mb-6">
      <h2 class="text-sm font-semibold text-gray-500 mb-3">飞书账号绑定</h2>
      <p class="text-xs text-gray-400 mb-3">绑定后可在任务指派、提交审核时接收飞书通知，平台将显示飞书头像和昵称</p>

      <div v-if="feishuBound" class="flex items-center gap-3">
        <img v-if="feishuAvatar" :src="feishuAvatar" class="w-10 h-10 rounded-full" alt="" />
        <div class="flex-1">
          <div class="font-medium text-sm">{{ feishuName }}</div>
          <div class="text-xs text-green-600">已绑定</div>
        </div>
        <button class="btn-secondary text-sm" @click="unbindFeishu">解除绑定</button>
      </div>

      <div v-else>
        <button class="btn-primary text-sm" @click="bindFeishu">
          <span class="i-lucide-link w-4 h-4 inline-block align-middle mr-1" />绑定飞书账号
        </button>
        <ErrorMessage :message="feishuError" class="mt-2" />
      </div>
    </div>

    <!-- 修改密码 -->
    <ModalDialog
      :visible="showChangePassword"
      title="修改密码"
      confirm-text="确认修改"
      cancel-text="取消"
      :error="changePasswordError"
      @close="showChangePassword = false"
      @confirm="submitChangePassword"
    >
      <div class="space-y-4">
        <div v-if="!hasPassword" class="text-sm text-blue-500 bg-blue-50 rounded-lg px-3 py-2">
          💡 您通过飞书登录，可直接设置密码
        </div>
        <FormField v-if="hasPassword" label="当前密码" :required="true">
          <div class="relative">
            <input v-model="changePasswordForm.currentPassword" class="input pr-8" :type="showPw.current ? 'text' : 'password'" placeholder="输入当前密码" />
            <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" @click="showPw.current = !showPw.current">
              <span :class="showPw.current ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="w-4 h-4 inline-block align-middle" />
            </button>
          </div>
        </FormField>
        <FormField label="新密码" :required="true">
          <div class="relative">
            <input v-model="changePasswordForm.newPassword" class="input pr-8" :type="showPw.new ? 'text' : 'password'" placeholder="至少8位，含大小写字母、数字、特殊字符中至少3种" />
            <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" @click="showPw.new = !showPw.new">
              <span :class="showPw.new ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="w-4 h-4 inline-block align-middle" />
            </button>
          </div>
        </FormField>
        <FormField label="确认密码" :required="true">
          <div class="relative">
            <input v-model="changePasswordForm.confirmPassword" class="input pr-8" :type="showPw.confirm ? 'text' : 'password'" placeholder="再次输入新密码" />
            <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" @click="showPw.confirm = !showPw.confirm">
              <span :class="showPw.confirm ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="w-4 h-4 inline-block align-middle" />
            </button>
          </div>
        </FormField>
      </div>
    </ModalDialog>
  </div>
</template>
