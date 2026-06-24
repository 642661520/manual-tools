<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const status = ref<'loading' | 'success' | 'error'>('loading')
const mode = ref<'login' | 'bind'>('bind')
const errorMsg = ref('')
const successMsg = ref('')

onMounted(async () => {
  const code = route.query.code as string | undefined
  const stateParam = route.query.state as string | undefined

  if (!code) {
    status.value = 'error'
    errorMsg.value = '未获取到授权码'
    return
  }

  // 根据 state 判断是登录还是绑定
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
    const res = await fetch('/api/auth/feishu/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    if (!res.ok) {
      const body = await res.json()
      status.value = 'error'
      errorMsg.value = body.error || '登录失败'
      return
    }

    const data = await res.json()
    localStorage.setItem('auth_token', data.token)
    localStorage.setItem('auth_user', JSON.stringify(data.user))
    status.value = 'success'
    successMsg.value = data.user.role === 'guest'
      ? '登录成功，您的账号正在等待管理员授权'
      : '登录成功'

    setTimeout(() => {
      window.location.href = '/features'
    }, 1500)
  } catch (e: unknown) {
    status.value = 'error'
    errorMsg.value = e instanceof Error ? e.message : '网络错误'
  }
}

async function handleBind(code: string) {
  const token = localStorage.getItem('auth_token')
  if (!token) {
    status.value = 'error'
    errorMsg.value = '登录已过期，请重新登录后再试'
    return
  }

  try {
    const res = await fetch('/api/auth/me/feishu-binding', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code }),
    })

    if (!res.ok) {
      const body = await res.json()
      status.value = 'error'
      errorMsg.value = body.error || '绑定失败'
      return
    }

    const data = await res.json()
    status.value = 'success'
    successMsg.value = '飞书账号绑定成功'

    // 通知设置页刷新
    if (window.opener) {
      window.opener.postMessage({
        type: 'feishu-bound',
        name: data.name,
        avatarUrl: data.avatarUrl,
      }, window.location.origin)
    }

    setTimeout(() => window.close(), 1500)
  } catch (e: unknown) {
    status.value = 'error'
    errorMsg.value = e instanceof Error ? e.message : '网络错误'
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="card w-96 text-center py-8">
      <!-- 加载中 -->
      <div v-if="status === 'loading'" class="text-gray-400">
        <span class="i-lucide-loader-2 w-10 h-10 inline-block animate-spin mb-3" />
        <p class="text-sm">{{ mode === 'login' ? '正在登录...' : '正在绑定飞书账号...' }}</p>
      </div>

      <!-- 成功 -->
      <div v-else-if="status === 'success'" class="text-green-600">
        <span class="i-lucide-check-circle w-12 h-12 inline-block mb-3" />
        <p class="text-lg font-semibold">{{ successMsg }}</p>
      </div>

      <!-- 失败 -->
      <div v-else class="text-red-500">
        <span class="i-lucide-x-circle w-12 h-12 inline-block mb-3" />
        <p class="text-lg font-semibold mb-1">{{ mode === 'login' ? '登录失败' : '绑定失败' }}</p>
        <p class="text-sm text-gray-500">{{ errorMsg }}</p>
        <p class="text-xs text-gray-400 mt-3">
          {{ mode === 'login' ? '请返回登录页重试' : '请关闭此窗口，从个人中心重新发起绑定' }}
        </p>
      </div>
    </div>
  </div>
</template>
