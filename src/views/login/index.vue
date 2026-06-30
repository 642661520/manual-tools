<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { getFeishuLoginUrl } from '@/api/endpoints/auth'
import { isFeishuClient } from '@/composables/useFeishuAutoLogin'
import FormField from '@/components/FormField.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import PasswordInput from '@/components/PasswordInput.vue'

const router = useRouter()
const route = useRoute()
const { login } = useAuth()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

// 飞书客户端自动 OAuth 登录
const autoLogging = ref(false)
const oauthCountdown = ref(0)

async function tryAutoLogin() {
  if (!isFeishuClient()) {
    autoLogging.value = false
    return
  }

  autoLogging.value = true
  oauthCountdown.value = 2

  const redirect = route.query.redirect as string | undefined

  const timer = setInterval(() => {
    oauthCountdown.value--
    if (oauthCountdown.value <= 0) clearInterval(timer)
  }, 1000)

  await new Promise((r) => setTimeout(r, 2000))
  clearInterval(timer)
  oauthCountdown.value = 0

  try {
    const { url } = await getFeishuLoginUrl(redirect)
    window.location.href = url
  } catch {
    autoLogging.value = false
  }
}

onMounted(() => {
  tryAutoLogin()
})

async function handleLogin() {
  if (!username.value.trim() || !password.value.trim()) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await login(username.value.trim(), password.value)
    const redirect = route.query.redirect as string | undefined
    if (redirect) {
      window.location.href = redirect
    } else {
      router.push('/features')
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '登录失败'
  } finally {
    loading.value = false
  }
}

const feishuLoading = ref(false)
async function feishuLogin() {
  feishuLoading.value = true
  try {
    const { url } = await getFeishuLoginUrl()
    window.location.href = url
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '飞书登录失败'
  } finally {
    feishuLoading.value = false
  }
}
</script>

<template>
  <div
    class="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50/60 via-white to-slate-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950 px-4 relative overflow-hidden"
  >
    <!-- 浮动光斑 -->
    <div class="absolute inset-0 z-0 pointer-events-none hidden dark:hidden" aria-hidden="true">
      <div
        class="absolute w-[600px] h-[600px] rounded-full bg-gradient-to-br from-blue-300/40 via-sky-200/25 to-transparent blur-3xl float-slow"
        style="top: -15%; left: -10%"
      />
      <div
        class="absolute w-[500px] h-[500px] rounded-full bg-gradient-to-tl from-indigo-300/35 via-purple-200/20 to-transparent blur-3xl float-slower"
        style="bottom: -10%; right: -8%"
      />
    </div>

    <!-- 卡片后方柔光（暗色模式下隐藏） -->
    <div
      class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[400px] rounded-full bg-gradient-to-tr from-blue-100/60 via-blue-50/30 to-transparent blur-3xl z-0 pointer-events-none hidden dark:hidden"
    />

    <!-- 卡片 -->
    <div class="relative z-10 w-96 max-w-full">
      <div class="card !shadow-lg p-8">
        <!-- 自动登录中 -->
        <template v-if="autoLogging">
          <div class="text-center mb-6">
            <img src="/favicon.svg" alt="Logo" class="w-14 h-14 mx-auto mb-3" />
            <h1 class="text-2xl font-bold text-primary">操作手册编写平台</h1>
          </div>
          <div class="text-center text-muted py-2">
            <span class="i-lucide-loader-2 w-8 h-8 inline-block animate-spin mb-3" />
            <p class="text-sm font-medium">
              正在跳转飞书授权登录...（{{ oauthCountdown }}秒后自动跳转）
            </p>
          </div>
        </template>

        <!-- 登录表单 -->
        <template v-else>
          <div class="text-center mb-6">
            <img src="/favicon.svg" alt="Logo" class="w-14 h-14 mx-auto mb-3" />
            <h1 class="text-2xl font-bold text-primary">操作手册编写平台</h1>
            <p class="text-sm text-secondary mt-1">请登录系统</p>
          </div>

          <form class="space-y-3" @submit.prevent="handleLogin">
            <ErrorMessage :message="error" />

            <FormField label="用户名">
              <input
                v-model="username"
                class="input"
                type="text"
                placeholder="输入用户名"
                autofocus
              />
            </FormField>

            <FormField label="密码">
              <PasswordInput v-model="password" placeholder="输入密码" />
            </FormField>

            <button type="submit" class="btn-primary w-full justify-center" :disabled="loading">
              {{ loading ? '登录中...' : '登录' }}
            </button>
          </form>

          <div class="relative my-3">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-default" />
            </div>
            <div class="relative flex justify-center text-xs">
              <span class="bg-surface px-2 text-muted">或</span>
            </div>
          </div>

          <button
            class="btn-secondary w-full justify-center"
            :disabled="feishuLoading"
            @click="feishuLogin"
          >
            <span class="i-lucide-link w-4 h-4 inline-block align-middle mr-1" />{{
              feishuLoading ? '跳转中...' : '飞书登录'
            }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes float-slow {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(30px, -20px) scale(1.08);
  }
  66% {
    transform: translate(-15px, 15px) scale(0.95);
  }
}
@keyframes float-slower {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(-25px, -15px) scale(1.05);
  }
  66% {
    transform: translate(20px, 10px) scale(0.97);
  }
}
.float-slow {
  animation: float-slow 12s ease-in-out infinite;
}
.float-slower {
  animation: float-slower 15s ease-in-out infinite;
}
</style>
