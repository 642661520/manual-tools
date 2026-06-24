<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { useDialog } from '@/composables/useDialog'
import SelectDropdown from '@/components/SelectDropdown.vue'

const router = useRouter()
const route = useRoute()
const { user, isPM, isGuest, logout } = useAuth()
const { projects, currentProjectId, loadProjects, switchProject } = useProject()
const { confirm } = useDialog()

const navItems = [
  { path: '/features', label: '主题', icon: 'i-lucide-clipboard-list', hideForGuest: true },
  { path: '/todos', label: '待办', icon: 'i-lucide-list-checks', hideForGuest: true },
  { path: '/preview', label: '预览', icon: 'i-lucide-book-open', hideForGuest: true },
  { path: '/profile', label: '我的', icon: 'i-lucide-user' },
]

const pmItems = [
  { path: '/catalogs/new', label: '目录', icon: 'i-lucide-pencil' },
  { path: '/settings', label: '设置', icon: 'i-lucide-settings' },
]

function isActive(path: string) {
  if (path === '/catalogs/new') return route.path.startsWith('/catalogs/')
  return route.path.startsWith(path)
}

async function handleProjectSwitch(id: string) {
  const targetProject = projects.value.find(p => p.id === id)
  const targetName = targetProject?.name || '新项目'
  const ok = await confirm(`切换到「${targetName}」？当前页面的数据将切换为该项目的对应内容。`)
  if (!ok) return

  const p = route.path
  const isDetailPage =
    (p.startsWith('/features/') && p !== '/features') ||
    (p.startsWith('/catalogs/'))

  switchProject(id)
  if (isDetailPage) {
    if (p.startsWith('/features/')) {
      router.push('/features')
    } else {
      router.push('/preview')
    }
  }
}

async function handleLogout() {
  if (!await confirm('确定退出登录？')) return
  logout()
}

onMounted(loadProjects)
</script>

<template>
  <div class="h-screen flex flex-col">
    <!-- 顶部导航 -->
    <header class="flex items-center justify-between px-6 py-2 bg-white border-b border-gray-200 flex-shrink-0">
      <div class="flex items-center gap-1">
        <span class="text-sm font-semibold text-gray-400 mr-3">manual-tools</span>
        <button
          v-for="item in navItems.filter(i => !i.hideForGuest || !isGuest)"
          :key="item.path"
          class="px-3 py-1.5 rounded-md text-sm transition-colors"
          :class="isActive(item.path)
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-600 hover:bg-gray-100'"
          @click="router.push(item.path)"
        >
          <span :class="item.icon" class="mr-1 w-4 h-4 inline-block align-middle" />{{ item.label }}
        </button>
        <template v-if="isPM">
          <span class="text-gray-200 mx-1">|</span>
          <button
            v-for="item in pmItems"
            :key="item.path"
            class="px-3 py-1.5 rounded-md text-sm transition-colors"
            :class="isActive(item.path)
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'"
            @click="router.push(item.path)"
          >
            <span :class="item.icon" class="mr-1 w-4 h-4 inline-block align-middle" />{{ item.label }}
          </button>
        </template>
      </div>

      <div class="flex items-center gap-3">
        <!-- 项目选择器 -->
        <SelectDropdown
          v-if="projects.length > 1"
          width-class="w-48"
          placeholder="选择项目"
          :model-value="currentProjectId || ''"
          :options="projects.map(p => ({ value: p.id, label: p.name }))"
          @update:model-value="(val: string | number | null) => handleProjectSwitch(val as string)"
        />

        <span class="text-xs text-gray-400 flex items-center gap-1.5">
          <img v-if="user?.avatarUrl" :src="user.avatarUrl" class="w-5 h-5 rounded-full" alt="" />
          <span v-else class="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-blue-500 text-xs font-semibold flex-shrink-0">{{ (user?.displayName || user?.username || '?')[0] }}</span>
          {{ user?.feishuName || user?.displayName }}
          <span class="text-gray-300">·</span>
          {{ user?.role === 'pm' ? '产品' : user?.role === 'guest' ? '游客' : '运维' }}
        </span>
        <button class="text-xs text-gray-400 hover:text-red-500" @click="handleLogout">
          退出
        </button>
      </div>
    </header>

    <!-- 页面内容 -->
    <div class="flex-1 overflow-hidden">
      <slot />
    </div>
  </div>
</template>
