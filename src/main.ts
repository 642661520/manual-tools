import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Token 验证状态：app 生命周期内只验证一次
let tokenValidated = false
let tokenValid = false

async function validateToken(): Promise<boolean> {
  if (tokenValidated) return tokenValid

  const token = localStorage.getItem('auth_token')
  if (!token) {
    tokenValidated = true
    tokenValid = false
    return false
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
      tokenValidated = true
      tokenValid = false
      return false
    }
    // 同步最新的用户信息（角色可能已被管理员修改）
    const { user } = await res.json()
    localStorage.setItem('auth_user', JSON.stringify(user))
    tokenValidated = true
    tokenValid = true
    return true
  } catch {
    tokenValidated = true
    tokenValid = true // 网络不可达时放行，由后续 API 调用的 401 处理
    return true
  }
}

// 路由守卫：检查认证
router.beforeEach(async (to, _from, next) => {
  if (to.meta.requiresAuth) {
    const valid = await validateToken()
    if (!valid) return next('/login')

    const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
    // 游客只能访问个人中心
    if (user.role === 'guest' && to.name !== 'profile') {
      return next('/profile')
    }
    if (to.meta.requiresPM && user.role !== 'pm') {
      return next('/features')
    }
  }
  next()
})

const app = createApp(App)
app.use(router)
app.mount('#app')
