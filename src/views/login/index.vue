<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import FormField from '@/components/FormField.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'

const router = useRouter()
const { login } = useAuth()

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!username.value.trim() || !password.value.trim()) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await login(username.value.trim(), password.value)
    router.push('/features')
  } catch (e: any) {
    error.value = e.message || '登录失败'
  } finally {
    loading.value = false
  }
}

const feishuLoading = ref(false)
async function feishuLogin() {
  feishuLoading.value = true
  try {
    const res = await fetch('/api/auth/feishu/login-url')
    if (!res.ok) {
      const body = await res.json()
      error.value = body.error || '飞书登录未配置'
      return
    }
    const { url } = await res.json()
    window.location.href = url
  } catch (e: any) {
    error.value = e.message || '飞书登录失败'
  } finally {
    feishuLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50/60 via-white to-slate-50 px-4 relative overflow-hidden">
    <!-- 浮动光斑 -->
    <div class="absolute inset-0 z-0 pointer-events-none" aria-hidden="true">
      <div class="absolute w-[600px] h-[600px] rounded-full bg-gradient-to-br from-blue-300/40 via-sky-200/25 to-transparent blur-3xl float-slow" style="top: -15%; left: -10%;" />
      <div class="absolute w-[500px] h-[500px] rounded-full bg-gradient-to-tl from-indigo-300/35 via-purple-200/20 to-transparent blur-3xl float-slower" style="bottom: -10%; right: -8%;" />
    </div>

    <!-- 卡片后方柔光 -->
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[400px] rounded-full bg-gradient-to-tr from-blue-100/60 via-blue-50/30 to-transparent blur-3xl z-0 pointer-events-none" />

    <!-- 卡片 -->
    <div class="relative z-10 w-96 max-w-full">
      <div class="card !border-slate-200/80 !shadow-lg !shadow-slate-200/50 p-8">
        <div class="text-center mb-6">
          <div class="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mx-auto mb-3 shadow-md shadow-blue-500/20">
            <span class="i-lucide-book-open text-white w-6 h-6" />
          </div>
          <h1 class="text-2xl font-bold text-gray-900">操作手册编写平台</h1>
          <p class="text-sm text-gray-500 mt-1">请登录系统</p>
        </div>

        <form @submit.prevent="handleLogin" class="space-y-3">
          <ErrorMessage :message="error" />

          <FormField label="用户名">
            <input v-model="username" class="input" type="text" placeholder="输入用户名" autofocus />
          </FormField>

          <FormField label="密码">
            <div class="relative">
              <input v-model="password" class="input pr-8" :type="showPassword ? 'text' : 'password'" placeholder="输入密码" @keyup.enter="handleLogin" />
              <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" @click="showPassword = !showPassword">
                <span :class="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="w-4 h-4 inline-block align-middle" />
              </button>
            </div>
          </FormField>

          <button
            type="submit"
            class="btn-primary w-full justify-center"
            :disabled="loading"
          >
            {{ loading ? '登录中...' : '登录' }}
          </button>
        </form>

        <div class="relative my-3">
          <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-gray-200" /></div>
          <div class="relative flex justify-center text-xs"><span class="bg-white px-2 text-gray-400">或</span></div>
        </div>

        <button
          class="btn-secondary w-full justify-center"
          :disabled="feishuLoading"
          @click="feishuLogin"
        >
          <span class="i-lucide-link w-4 h-4 inline-block align-middle mr-1" />{{ feishuLoading ? '跳转中...' : '飞书登录' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes float-slow {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.08); }
  66% { transform: translate(-15px, 15px) scale(0.95); }
}
@keyframes float-slower {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(-25px, -15px) scale(1.05); }
  66% { transform: translate(20px, 10px) scale(0.97); }
}
.float-slow { animation: float-slow 12s ease-in-out infinite; }
.float-slower { animation: float-slower 15s ease-in-out infinite; }
</style>
