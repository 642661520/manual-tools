import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { getCurrentUser } from '@/api/endpoints/auth'
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
    const { user } = await getCurrentUser()
    localStorage.setItem('auth_user', JSON.stringify(user))
    tokenValidated = true
    tokenValid = true
    return true
  } catch {
    // API 返回 401 → token 无效
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    tokenValidated = true
    tokenValid = false
    return false
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
