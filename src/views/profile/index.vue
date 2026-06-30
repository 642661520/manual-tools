<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import { showErrorToast, showSuccessToast } from '@/composables/toast'
import {
  updateNotifyPrefs,
  getFeishuBindingStatus,
  getFeishuBindUrl,
  unbindFeishu as apiUnbindFeishu,
} from '@/api/endpoints/auth'
import { changePassword as apiChangePassword } from '@/api/endpoints/auth'
import ModalDialog from '@/components/ModalDialog.vue'
import FormField from '@/components/FormField.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import PasswordInput from '@/components/PasswordInput.vue'
import { isFeishuClient } from '@/composables/useFeishuAutoLogin'

const inFeishu = isFeishuClient()

const { user, isGuest, logout, refreshUser, token, updateProfile, updateUsername } = useAuth()
const { confirm } = useDialog()

async function handleLogout() {
  if (!(await confirm('确定退出登录？'))) return
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
    await updateNotifyPrefs({
      notifyEnabled: notifyEnabled.value ? 1 : 0,
      notifyPrefs: notifyPrefs.value,
    })
    if (user.value) {
      user.value.notifyEnabled = notifyEnabled.value
      user.value.notifyPrefs = { ...notifyPrefs.value }
    }
    showSuccessToast('通知设置已保存')
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '保存通知设置失败')
  } finally {
    notifySaving.value = false
  }
}

function toggleNotifyEnabled() {
  notifyEnabled.value = !notifyEnabled.value
  saveNotifyPrefs()
}

function toggleNotifyPref(key: 'assign' | 'review' | 'project' | 'status') {
  notifyPrefs.value[key] = !notifyPrefs.value[key]
  saveNotifyPrefs()
}

const notifyLabels: { key: 'assign' | 'review' | 'project' | 'status'; label: string }[] = [
  { key: 'assign', label: '任务指派与移除' },
  { key: 'review', label: '审核相关（提交/通过/退回）' },
  { key: 'project', label: '项目与角色变更' },
  { key: 'status', label: '状态重置' },
]

async function loadFeishuBinding() {
  try {
    const data = await getFeishuBindingStatus()
    feishuBound.value = data.bound
    feishuName.value = data.name || ''
    feishuAvatar.value = data.avatarUrl || ''
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '加载飞书绑定状态失败')
  }
}

async function bindFeishu() {
  feishuError.value = ''
  try {
    const { url } = await getFeishuBindUrl()

    const width = 600
    const height = 700
    const left = window.screenX + (window.innerWidth - width) / 2
    const top = window.screenY + (window.innerHeight - height) / 2
    const popup = window.open(
      url,
      'feishu-bind',
      `width=${width},height=${height},left=${left},top=${top}`,
    )

    if (!popup) {
      feishuError.value = '弹出窗口被拦截，请允许弹出窗口'
      return
    }

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
  if (!(await confirm('确定解除飞书绑定？'))) return
  try {
    await apiUnbindFeishu()
    feishuBound.value = false
    feishuName.value = ''
    feishuAvatar.value = ''
    showSuccessToast('飞书已解绑')
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '解绑飞书失败')
  }
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = { admin: '系统管理员', member: '普通用户', guest: '游客' }
  return labels[role] || role
}

// 编辑个人资料（弹窗）
const showEditProfile = ref(false)
const editProfileForm = ref({ displayName: '', username: '' })
const editProfileError = ref('')
const savingEditProfile = ref(false)
const isFeishuAutoUsername = computed(() => /^feishu_ou_/.test(user.value?.username || ''))
const canChangeUsername = computed(() => isFeishuAutoUsername.value && !user.value?.usernameChanged)

function openEditProfile() {
  editProfileForm.value = {
    displayName: user.value?.displayName || '',
    username: user.value?.username || '',
  }
  editProfileError.value = ''
  showEditProfile.value = true
}

async function submitEditProfile() {
  editProfileError.value = ''
  const dn = editProfileForm.value.displayName.trim()
  const un = editProfileForm.value.username.trim()

  if (!dn) {
    editProfileError.value = '显示名称不能为空'
    return
  }
  if (dn.length > 64) {
    editProfileError.value = '显示名称不能超过64个字符'
    return
  }
  if (canChangeUsername.value) {
    if (!un) {
      editProfileError.value = '用户名不能为空'
      return
    }
    if (un.length < 3) {
      editProfileError.value = '用户名不能少于3个字符'
      return
    }
    if (un.length > 32) {
      editProfileError.value = '用户名不能超过32个字符'
      return
    }
    if (!/^[a-zA-Z0-9_]+$/.test(un)) {
      editProfileError.value = '用户名只能包含字母、数字和下划线'
      return
    }
  }

  savingEditProfile.value = true
  try {
    if (dn !== (user.value?.displayName || '')) {
      await updateProfile(dn)
    }
    if (canChangeUsername.value && un !== (user.value?.username || '')) {
      await updateUsername(un)
    }
    showEditProfile.value = false
    showSuccessToast('个人信息已更新')
  } catch (e: unknown) {
    editProfileError.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    savingEditProfile.value = false
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
    const data = await apiChangePassword({
      currentPassword: hasPassword.value ? currentPassword : undefined,
      newPassword,
    })
    token.value = data.token
    localStorage.setItem('auth_token', data.token)
    showChangePassword.value = false
    await refreshUser()
    showSuccessToast('密码已修改')
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
  <div class="p-4 sm:p-6 max-w-2xl mx-auto h-full overflow-y-auto">
    <h1 class="text-2xl font-bold mb-6">个人中心</h1>

    <!-- 游客权限提示 -->
    <div v-if="isGuest" class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
      <h2 class="font-semibold text-amber-800 text-sm flex items-center gap-2">
        <span class="i-lucide-alert-triangle w-4 h-4 inline-block align-middle" />账号待授权
      </h2>
      <p class="text-sm text-amber-600 mt-1">
        您的账号尚未获得操作权限。请联系系统管理员将您的角色从「游客」升级为「运维人员」或「产品」。
      </p>
    </div>

    <!-- 当前用户 -->
    <div class="card mb-6">
      <h2 class="text-sm font-semibold text-secondary mb-3">个人信息</h2>
      <div class="flex items-start gap-4">
        <UserAvatar
          :avatar-url="feishuBound ? feishuAvatar : null"
          :name="user?.displayName || user?.username"
          size="lg"
        />
        <div class="flex-1 min-w-0">
          <div class="text-lg font-medium truncate">
            {{ user?.displayName }}
          </div>
          <div class="text-sm text-secondary mt-0.5">
            <span class="text-muted">用户名：</span>
            <code class="bg-hover px-1 rounded text-xs">{{ user?.username }}</code>
          </div>
          <div
            v-if="isFeishuAutoUsername && !user?.usernameChanged"
            class="text-amber-500 text-xs mt-0.5"
          >
            该用户名为飞书自动生成，建议修改为易记的用户名
          </div>
          <div v-if="user?.usernameChanged" class="text-muted text-xs mt-0.5">
            用户名已修改，不可再次更改
          </div>
          <div class="text-sm text-secondary mt-0.5">
            {{ roleLabel(user?.role || '') }}
            <span v-if="feishuBound" class="text-green-600 ml-2 text-xs">已绑定飞书</span>
          </div>
        </div>
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
          <button
            class="btn-secondary text-sm w-full sm:w-auto justify-center"
            @click="openEditProfile"
          >
            编辑资料
          </button>
          <button
            class="btn-secondary text-sm w-full sm:w-auto justify-center"
            @click="openChangePassword"
          >
            修改密码
          </button>
          <button
            v-if="!inFeishu"
            class="btn-secondary text-sm w-full sm:w-auto justify-center"
            @click="handleLogout"
          >
            退出登录
          </button>
        </div>
      </div>
    </div>

    <!-- 通知偏好 -->
    <div class="card mb-6">
      <h2 class="text-sm font-semibold text-secondary mb-3">通知偏好</h2>
      <p class="text-xs text-muted mb-4">
        绑定飞书后可接收通知。关闭后不再收到对应类型的飞书消息。
      </p>

      <!-- 全局开关 -->
      <label class="flex items-center justify-between py-2 cursor-pointer">
        <span class="text-sm">接收飞书通知</span>
        <button
          class="relative w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0"
          :class="notifyEnabled ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-border-input)]'"
          @click="toggleNotifyEnabled"
        >
          <span
            class="absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-surface shadow transition-transform duration-200"
            :class="notifyEnabled ? 'translate-x-4.5' : ''"
          />
        </button>
      </label>

      <!-- 分类开关 -->
      <div
        class="border-t border-light mt-3 pt-3 space-y-2"
        :class="{ 'opacity-50 pointer-events-none': !notifyEnabled }"
      >
        <label
          v-for="item in notifyLabels"
          :key="item.key"
          class="flex items-center justify-between py-1.5 cursor-pointer"
        >
          <span class="text-sm text-secondary">{{ item.label }}</span>
          <button
            class="relative w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0"
            :class="notifyPrefs[item.key] ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-border-input)]'"
            @click="() => toggleNotifyPref(item.key)"
          >
            <span
              class="absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-surface shadow transition-transform duration-200"
              :class="notifyPrefs[item.key] ? 'translate-x-4.5' : ''"
            />
          </button>
        </label>
      </div>
    </div>

    <!-- 飞书账号绑定 -->
    <div class="card mb-6">
      <h2 class="text-sm font-semibold text-secondary mb-3">飞书账号绑定</h2>
      <p class="text-xs text-muted mb-3">
        绑定后可在任务指派、提交审核时接收飞书通知，平台将显示飞书头像和昵称
      </p>

      <div v-if="feishuBound" class="flex items-center gap-3">
        <img v-if="feishuAvatar" :src="feishuAvatar" class="w-10 h-10 rounded-full" alt="" />
        <div class="flex-1">
          <div class="font-medium text-sm">
            {{ feishuName }}
          </div>
          <div class="text-xs text-green-600">已绑定</div>
        </div>
        <button v-if="!inFeishu" class="btn-secondary text-sm" @click="unbindFeishu">
          解除绑定
        </button>
      </div>

      <div v-else>
        <button class="btn-primary text-sm" @click="bindFeishu">
          <span class="i-lucide-link w-4 h-4 inline-block align-middle mr-1" />绑定飞书账号
        </button>
        <ErrorMessage :message="feishuError" class="mt-2" />
      </div>
    </div>

    <!-- 编辑个人资料 -->
    <ModalDialog
      :visible="showEditProfile"
      title="编辑资料"
      confirm-text="保存"
      cancel-text="取消"
      :error="editProfileError"
      @close="showEditProfile = false"
      @confirm="submitEditProfile"
    >
      <div class="space-y-4">
        <FormField label="显示名称" :required="true">
          <input
            v-model="editProfileForm.displayName"
            class="input"
            maxlength="64"
            placeholder="输入显示名称"
            :disabled="savingEditProfile"
            @keyup.enter="submitEditProfile"
          />
        </FormField>
        <FormField label="用户名" :required="canChangeUsername">
          <input
            v-model="editProfileForm.username"
            class="input"
            maxlength="32"
            placeholder="字母、数字、下划线，3-32 位"
            :disabled="savingEditProfile || !canChangeUsername"
            @keyup.enter="submitEditProfile"
          />
          <p v-if="canChangeUsername" class="text-amber-500 text-xs mt-1">
            当前用户名为飞书自动生成，建议改为易记的名称，以便后续使用用户名+密码登录（仅可修改一次）
          </p>
          <p v-else-if="user?.usernameChanged" class="text-muted text-xs mt-1">
            用户名已修改，不可再次更改
          </p>
          <p v-else class="text-muted text-xs mt-1">用户名不可修改</p>
        </FormField>
      </div>
    </ModalDialog>

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
        <div
          v-if="!hasPassword"
          class="text-sm color-accent bg-active rounded-lg px-3 py-2 space-y-1"
        >
          <p>
            <span class="i-lucide-lightbulb w-4 h-4 inline-block align-middle mr-1" />
            您通过飞书登录，可直接设置密码。
          </p>
          <p v-if="isFeishuAutoUsername && !user?.usernameChanged" class="text-amber-600">
            <span class="i-lucide-alert-triangle w-4 h-4 inline-block align-middle mr-1" />
            当前用户名
            <code class="bg-amber-100 px-1 rounded text-xs">{{ user?.username }}</code>
            为自动生成，建议先点击「编辑资料」修改为易记的用户名，再设置密码。
          </p>
        </div>
        <FormField v-if="hasPassword" label="当前密码" :required="true">
          <PasswordInput v-model="changePasswordForm.currentPassword" placeholder="输入当前密码" />
        </FormField>
        <FormField label="新密码" :required="true">
          <PasswordInput
            v-model="changePasswordForm.newPassword"
            placeholder="至少8位，含大小写字母、数字、特殊字符中至少3种"
          />
        </FormField>
        <FormField label="确认密码" :required="true">
          <PasswordInput
            v-model="changePasswordForm.confirmPassword"
            placeholder="再次输入新密码"
          />
        </FormField>
      </div>
    </ModalDialog>
  </div>
</template>
