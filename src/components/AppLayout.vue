<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { useDialog } from '@/composables/useDialog'
import SelectDropdown from '@/components/SelectDropdown.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import SearchBox from '@/components/SearchBox.vue'

const router = useRouter()
const route = useRoute()
const { user, isAdmin, isGuest, canManageProject, logout } = useAuth()
const { projects, currentProjectId, loadProjects, switchProject } = useProject()
const { confirm } = useDialog()

const searchBoxRef = ref<InstanceType<typeof SearchBox>>()

const showUserMenu = ref(false)

const navItems = [
  { path: '/features', label: '章节', icon: 'i-lucide-clipboard-list', hideForGuest: true },
  { path: '/todos', label: '待办', icon: 'i-lucide-list-checks', hideForGuest: true },
  { path: '/preview', label: '预览', icon: 'i-lucide-book-open', hideForGuest: true },
]

function isActive(path: string) {
  if (path === '/catalogs/new') return route.path.startsWith('/catalogs/')
  return route.path.startsWith(path)
}

function roleLabel(role: string) {
  const map: Record<string, string> = { admin: '系统管理员', member: '成员', guest: '游客' }
  return map[role] || role
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
  showUserMenu.value = false
  if (!await confirm('确定退出登录？')) return
  logout()
}

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value
}

function closeUserMenu() {
  showUserMenu.value = false
}

onMounted(loadProjects)
</script>

<template>
  <div class="h-screen flex flex-col">
    <!-- 顶部导航 -->
    <header class="flex items-center justify-between px-6 py-2 bg-white border-b border-gray-200 flex-shrink-0">
      <div class="flex items-center gap-1">
        <img src="/favicon.svg" alt="Logo" class="w-6 h-6 mr-2 flex-shrink-0" />
        <span class="text-sm font-semibold text-gray-400 mr-2">操作手册编写平台</span>
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
        <!-- 目录编排 + 项目设置：仅项目 pm+ 可见 -->
        <template v-if="canManageProject">
          <span class="text-gray-200 mx-1">|</span>
          <button
            class="px-3 py-1.5 rounded-md text-sm transition-colors"
            :class="isActive('/catalogs/new')
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'"
            @click="router.push('/catalogs/new')"
          >
            <span class="i-lucide-pencil mr-1 w-4 h-4 inline-block align-middle" />目录
          </button>
          <button
            class="px-3 py-1.5 rounded-md text-sm transition-colors"
            :class="route.path.startsWith('/settings/project')
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'"
            @click="router.push('/settings/project')"
          >
            <span class="i-lucide-settings mr-1 w-4 h-4 inline-block align-middle" />设置
          </button>
        </template>
      </div>

      <div class="flex items-center gap-3">
        <!-- 搜索按钮 -->
        <button
          v-if="currentProjectId"
          class="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 px-2.5 py-1.5 rounded-md transition-colors"
          @click="searchBoxRef?.open()"
        >
          <span class="i-lucide-search w-4 h-4" />
          <span class="hidden sm:inline">搜索</span>
          <kbd class="hidden lg:inline text-xs text-gray-300 ml-0.5">Ctrl+K</kbd>
        </button>

        <!-- 项目选择器 -->
        <SelectDropdown
          v-if="projects.length > 1"
          width-class="w-48"
          placeholder="选择项目"
          :model-value="currentProjectId || ''"
          :options="projects.map(p => ({ value: p.id, label: p.name }))"
          @update:model-value="(val: string | number | null) => handleProjectSwitch(val as string)"
        />

        <!-- 用户头像下拉 -->
        <div class="relative">
          <button
            class="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            @click="toggleUserMenu"
            @blur="closeUserMenu"
          >
            <UserAvatar :avatar-url="user?.avatarUrl" :name="user?.displayName || user?.username" size="sm" />
            {{ user?.feishuName || user?.displayName }}
            <span class="text-gray-300">·</span>
            {{ roleLabel(user?.role || '') }}
            <span class="i-lucide-chevron-down w-3 h-3" />
          </button>

          <!-- 下拉菜单 -->
          <div
            v-if="showUserMenu"
            class="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 min-w-32 py-1"
            @mousedown.prevent
          >
            <button
              class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              @click="router.push('/profile'); closeUserMenu()"
            >
              <span class="i-lucide-user w-4 h-4" />个人中心
            </button>
            <button
              v-if="isAdmin"
              class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              @click="router.push('/settings'); closeUserMenu()"
            >
              <span class="i-lucide-shield w-4 h-4" />系统设置
            </button>
            <div class="border-t border-gray-100 my-1" />
            <button
              class="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2"
              @click="handleLogout"
            >
              <span class="i-lucide-log-out w-4 h-4" />退出登录
            </button>
          </div>
        </div>
      </div>
    </header>

    <SearchBox ref="searchBoxRef" />

    <!-- 页面内容 -->
    <div class="flex-1 overflow-hidden">
      <slot />
    </div>
  </div>
</template>

<style>
@media print {
  @page { margin: 1.5cm; }
  /* 隐藏顶部导航 */
  header {
    display: none !important;
  }
  /* 移除内容区域的限制 */
  .flex-1.overflow-hidden {
    overflow: visible !important;
  }
  /* 隐藏所有浮层、下拉菜单、弹窗 */
  body > [style*="z-index"],
  .dialog-container,
  [class*="modal-overlay"] {
    display: none !important;
  }
}
</style>