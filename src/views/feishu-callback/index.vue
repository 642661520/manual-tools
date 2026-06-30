<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { feishuLogin, bindFeishu } from '@/api/endpoints/auth'
import { ApiRequestError } from '@shared/types'

const route = useRoute()
const status = ref<'loading' | 'success' | 'error'>('loading')
const mode = ref<'login' | 'bind'>('bind')
const errorMsg = ref('')
const successMsg = ref('')

/** 从 state 参数中解码 redirect 目标地址
 *  state 格式: login:<base64_redirect>:<random> 或 login:<random> */
function parseRedirectFromState(stateParam?: string): string | null {
  if (!stateParam) return null
  const parts = stateParam.split(':')
  // login:<base64>:<random> → parts[1] 是 base64 编码的 redirect
  if (parts.length === 3 && parts[0] === 'login') {
    try {
      return window.atob(parts[1])
    } catch {
      return null
    }
  }
  return null
}

onMounted(async () => {
  const code = route.query.code as string | undefined
  const stateParam = route.query.state as string | undefined

  if (!code) {
    status.value = 'error'
    errorMsg.value = '未获取到授权码'
    return
  }

  if (stateParam?.startsWith('login:')) {
    mode.value = 'login'
    await handleLogin(code)
  } else {
    mode.value = 'bind'
    await handleBind(code)
  }
})

async function handleLogin(code: string) {
  try {
    const data = await feishuLogin(code)
    localStorage.setItem('auth_token', data.token)
    localStorage.setItem('auth_user', JSON.stringify(data.user))
    status.value = 'success'
    successMsg.value =
      data.user.role === 'guest' ? '登录成功，您的账号正在等待系统管理员授权' : '登录成功'

    const stateParam = route.query.state as string | undefined
    const redirect = parseRedirectFromState(stateParam)

    setTimeout(() => {
      window.location.href = redirect || '/features'
    }, 1500)
  } catch (e: unknown) {
    status.value = 'error'
    if (e instanceof ApiRequestError) {
      errorMsg.value = e.message
    } else {
      errorMsg.value = e instanceof Error ? e.message : '网络错误'
    }
  }
}

async function handleBind(code: string) {
  try {
    const data = await bindFeishu(code)
    status.value = 'success'
    successMsg.value = '飞书账号绑定成功'

    if (window.opener) {
      window.opener.postMessage(
        {
          type: 'feishu-bound',
          name: data.name,
          avatarUrl: data.avatarUrl,
        },
        window.location.origin,
      )
    }

    setTimeout(() => window.close(), 1500)
  } catch (e: unknown) {
    status.value = 'error'
    if (e instanceof ApiRequestError) {
      errorMsg.value = e.message
    } else {
      errorMsg.value = e instanceof Error ? e.message : '网络错误'
    }
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-base">
    <div class="card w-96 text-center py-8">
      <!-- 加载中 -->
      <div v-if="status === 'loading'" class="text-muted">
        <span class="i-lucide-loader-2 w-10 h-10 inline-block animate-spin mb-3" />
        <p class="text-sm">
          {{ mode === 'login' ? '正在登录...' : '正在绑定飞书账号...' }}
        </p>
      </div>

      <!-- 成功 -->
      <div v-else-if="status === 'success'" class="text-green-600">
        <span class="i-lucide-check-circle w-12 h-12 inline-block mb-3" />
        <p class="text-lg font-semibold">
          {{ successMsg }}
        </p>
      </div>

      <!-- 失败 -->
      <div v-else class="text-red-500">
        <span class="i-lucide-x-circle w-12 h-12 inline-block mb-3" />
        <p class="text-lg font-semibold mb-1">
          {{ mode === 'login' ? '登录失败' : '绑定失败' }}
        </p>
        <p class="text-sm text-secondary">
          {{ errorMsg }}
        </p>
        <p class="text-xs text-muted mt-3">
          {{ mode === 'login' ? '请返回登录页重试' : '请关闭此窗口，从个人中心重新发起绑定' }}
        </p>
      </div>
    </div>
  </div>
</template>
