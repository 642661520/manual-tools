import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { getCurrentUser } from '@/api/endpoints/auth'
import { getStoredUser } from '@/utils/storage'
import { vTooltip } from './directives/tooltip'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Token 验证状态：app 生命周期内只验证一次（仅缓存成功结果）
let tokenValidated = false
let tokenValid = false

/** 重置 token 验证缓存，登录成功后调用 */
export function resetTokenValidation() {
  tokenValidated = false
  tokenValid = false
}

async function validateToken(): Promise<boolean> {
  // 仅缓存成功结果；失败不缓存，允许在同一会话中重新登录后重试
  if (tokenValidated && tokenValid) return true

  const token = localStorage.getItem('auth_token')
  if (!token) {
    // 无 token 不视为"已验证"，允许后续登录后重试
    tokenValidated = false
    tokenValid = false
    return false
  }

  try {
    const { user } = await getCurrentUser()
    localStorage.setItem('auth_user', JSON.stringify(user))
    tokenValidated = true
    tokenValid = true
    return true
  } catch {
    // API 返回 401 → token 无效，清除旧数据但不缓存失败结果
    // 不设 tokenValidated=true，允许用户重新登录后再次验证
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    tokenValid = false
    return false
  }
}

// 路由守卫：检查认证
router.beforeEach(async (to, _from, next) => {
  // 已登录用户访问登录页 → 重定向到首页
  if (to.name === 'login' && localStorage.getItem('auth_token')) {
    return next('/features')
  }

  if (to.meta.requiresAuth) {
    const valid = await validateToken()
    if (!valid) return next('/login')

    const user = getStoredUser()
    // 游客只能访问个人中心
    if (user?.role === 'guest' && to.name !== 'profile') {
      return next('/profile')
    }
    // 系统设置仅 admin 可访问
    if (to.meta.requiresAdmin && user?.role !== 'admin') {
      return next('/features')
    }
  }
  next()
})

// ---- 全局前端错误上报 ----

function getCsrfToken(): string {
  const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
  return token || ''
}

function reportFrontendError(payload: { message: string; stack?: string }) {
  const token = localStorage.getItem('auth_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const csrf = getCsrfToken()
  if (csrf) headers['X-CSRF-Token'] = csrf

  fetch('/api/v1/log/frontend', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...payload,
      url: window.location.href,
      userAgent: navigator.userAgent,
    }),
  }).catch(() => { /* 上报失败不影响用户 */ })
}

// JS 运行时错误
window.addEventListener('error', (event) => {
  if (event.error) {
    reportFrontendError({
      message: event.message || '未知运行时错误',
      stack: event.error?.stack,
    })
  }
})

// 未处理的 Promise 拒绝
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  reportFrontendError({
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})

const app = createApp(App)

// Vue 应用级错误
app.config.errorHandler = (err, _instance, info) => {
  reportFrontendError({
    message: `[Vue ${info}]: ${err instanceof Error ? err.message : String(err)}`,
    stack: err instanceof Error ? err.stack : undefined,
  })
}

app.use(router)
app.directive('tooltip', vTooltip)
app.mount('#app')
