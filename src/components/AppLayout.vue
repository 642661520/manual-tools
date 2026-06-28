<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { useDialog } from '@/composables/useDialog'
import { toasts } from '@/composables/toast'
import SelectDropdown from '@/components/SelectDropdown.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import SearchBox from '@/components/SearchBox.vue'

const router = useRouter()
const route = useRoute()
const { user, isAdmin, isMember, isGuest, canManageProject, logout } = useAuth()
const { projects, currentProjectId, loaded, loadProjects, switchProject } = useProject()
const { confirm } = useDialog()

const searchBoxRef = ref<InstanceType<typeof SearchBox>>()

const showUserMenu = ref(false)
const showMobileNav = ref(false)

const navItems = [
  { path: '/features', label: '内容', icon: 'i-lucide-clipboard-list', hideForGuest: true },
  { path: '/todos', label: '待办', icon: 'i-lucide-list-checks', hideForGuest: true },
  { path: '/manuals', label: '手册', icon: 'i-lucide-book-open', hideForGuest: true },
]

function filteredNavItems() {
  return navItems.filter((i) => !i.hideForGuest || !isGuest.value)
}

function isActive(path: string) {
  return route.path.startsWith(path)
}

function roleLabel(role: string) {
  const map: Record<string, string> = { admin: '系统管理员', member: '普通用户', guest: '游客' }
  return map[role] || role
}

async function handleProjectSwitch(id: string) {
  if (id === currentProjectId.value) return
  const targetProject = projects.value.find((p) => p.id === id)
  const targetName = targetProject?.name || '新项目'
  const ok = await confirm(`切换到「${targetName}」？当前页面的数据将切换为该项目的对应内容。`)
  if (!ok) return

  const p = route.path
  const isDetailPage =
    (p.startsWith('/features/') && p !== '/features') ||
    (p.startsWith('/manuals/') && p !== '/manuals')

  switchProject(id)
  if (isDetailPage) {
    if (p.startsWith('/features/')) {
      router.push('/features')
    } else {
      router.push('/manuals')
    }
  }
}

async function handleLogout() {
  showUserMenu.value = false
  showMobileNav.value = false
  if (!(await confirm('确定退出登录？'))) return
  logout()
}

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value
}

function closeUserMenu() {
  showUserMenu.value = false
}

function goToProfile() {
  router.push('/profile')
  closeUserMenu()
  closeMobileNav()
}

function goToSettings() {
  router.push('/settings')
  closeUserMenu()
  closeMobileNav()
}

function toggleMobileNav() {
  showMobileNav.value = !showMobileNav.value
}

function closeMobileNav() {
  showMobileNav.value = false
}

function onNavClick(path: string) {
  closeMobileNav()
  router.push(path)
}

// 点击外部关闭用户菜单
function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.user-menu-area')) {
    showUserMenu.value = false
  }
}

onMounted(() => {
  loadProjects()
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <div class="h-screen flex flex-col">
    <!-- 顶部导航 -->
    <header
      class="flex items-center justify-between px-3 sm:px-4 lg:px-6 py-2 bg-white border-b border-gray-200 flex-shrink-0"
    >
      <!-- 左侧：Logo + 汉堡 + 标题 + 桌面导航按钮 -->
      <div class="flex items-center gap-1">
        <!-- 移动端汉堡按钮 -->
        <button
          class="lg:hidden p-1.5 rounded hover:bg-gray-100 flex-shrink-0 flex items-center justify-center w-8 h-8"
          @click="toggleMobileNav"
        >
          <span class="i-lucide-menu w-5 h-5 text-gray-600" />
        </button>

        <img src="/favicon.svg" alt="Logo" class="w-6 h-6 sm:mr-2 flex-shrink-0" />
        <span class="hidden sm:inline text-sm font-semibold text-gray-400 mr-2 truncate"
          >操作手册编写平台</span
        >

        <!-- 桌面导航按钮 (lg+) -->
        <div class="hidden lg:flex items-center gap-1">
          <button
            v-for="item in filteredNavItems()"
            :key="item.path"
            class="px-3 py-1.5 rounded-md text-sm transition-colors"
            :class="
              isActive(item.path) ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            "
            @click="router.push(item.path)"
          >
            <span :class="item.icon" class="mr-1 w-4 h-4 inline-block align-middle" />{{
              item.label
            }}
          </button>
          <!-- 项目设置：仅项目 pm+ 可见 -->
          <template v-if="canManageProject">
            <span class="text-gray-200 mx-1">|</span>
            <button
              class="px-3 py-1.5 rounded-md text-sm transition-colors"
              :class="
                route.path.startsWith('/settings/project')
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              "
              @click="router.push('/settings/project')"
            >
              <span class="i-lucide-settings mr-1 w-4 h-4 inline-block align-middle" />设置
            </button>
          </template>
        </div>
      </div>

      <!-- 右侧：搜索 + 项目选择器 + 用户菜单 -->
      <div class="flex items-center gap-1 sm:gap-2 lg:gap-3">
        <!-- 搜索按钮 -->
        <button
          v-if="currentProjectId"
          class="flex items-center gap-1 sm:gap-1.5 text-xs text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 px-2 sm:px-2.5 py-1.5 rounded-md transition-colors"
          @click="searchBoxRef?.open()"
        >
          <span class="i-lucide-search w-4 h-4" />
          <span class="hidden sm:inline">搜索</span>
          <kbd class="hidden lg:inline text-xs text-gray-300 ml-0.5">Ctrl+K</kbd>
        </button>

        <!-- 项目选择器 -->
        <SelectDropdown
          v-if="projects.length > 0"
          width-class="w-36 lg:w-48"
          placeholder="选择项目"
          :model-value="currentProjectId || ''"
          :options="projects.map((p) => ({ value: p.id, label: p.name }))"
          @update:model-value="(val: string | number | null) => handleProjectSwitch(val as string)"
        />

        <!-- 用户头像下拉 -->
        <div class="relative user-menu-area">
          <button
            class="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            @click="toggleUserMenu"
          >
            <UserAvatar
              :avatar-url="user?.avatarUrl"
              :name="user?.displayName || user?.username"
              size="sm"
            />
            <span class="hidden sm:inline">{{ user?.feishuName || user?.displayName }}</span>
            <span class="hidden lg:inline text-gray-300">·</span>
            <span class="hidden lg:inline">{{ roleLabel(user?.role || '') }}</span>
            <span class="i-lucide-chevron-down w-3 h-3 hidden sm:inline" />
          </button>

          <!-- 下拉菜单 -->
          <div
            v-if="showUserMenu"
            class="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 min-w-32 py-1"
            @mousedown.prevent
          >
            <button
              class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              @click="goToProfile()"
            >
              <span class="i-lucide-user w-4 h-4" />个人中心
            </button>
            <a
              v-if="isAdmin"
              href="/docs/api"
              target="_blank"
              class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 no-underline"
              @click="closeUserMenu()"
            >
              <span class="i-lucide-file-code w-4 h-4" />API 文档
            </a>
            <button
              v-if="isAdmin"
              class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              @click="goToSettings()"
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
      <!-- member 用户未加入任何项目的提示 -->
      <div
        v-if="loaded && projects.length === 0 && isMember"
        class="h-full flex items-center justify-center"
      >
        <div class="text-center">
          <span class="i-lucide-folder-open text-5xl text-gray-300 mb-4 block mx-auto" />
          <p class="text-gray-500 text-lg font-medium">您尚未加入任何项目</p>
          <p class="text-gray-400 text-sm mt-1">请联系管理员将您添加到相关项目中</p>
        </div>
      </div>
      <slot v-else />
    </div>
  </div>

  <!-- 移动端导航 Drawer -->
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="showMobileNav" class="fixed inset-0 z-50 lg:hidden">
        <!-- 遮罩层 -->
        <div class="absolute inset-0 bg-black/40" @click="closeMobileNav" />
        <!-- Drawer 面板 -->
        <aside
          class="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col drawer-panel"
        >
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <span class="font-semibold text-sm text-gray-700">菜单</span>
            <button
              class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
              @click="closeMobileNav"
            >
              <span class="i-lucide-x w-5 h-5 text-gray-500" />
            </button>
          </div>

          <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            <!-- 导航项 -->
            <button
              v-for="item in filteredNavItems()"
              :key="item.path"
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors"
              :class="
                isActive(item.path)
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              "
              @click="onNavClick(item.path)"
            >
              <span :class="item.icon" class="w-5 h-5 flex-shrink-0" />
              {{ item.label }}
            </button>

            <!-- 项目设置入口 -->
            <template v-if="canManageProject">
              <div class="border-t border-gray-100 my-2" />
              <button
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                @click="onNavClick('/settings/project')"
              >
                <span class="i-lucide-settings w-5 h-5 flex-shrink-0" />项目设置
              </button>
            </template>

            <!-- 系统操作 -->
            <div class="border-t border-gray-100 my-2" />
            <button
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              @click="goToProfile()"
            >
              <span class="i-lucide-user w-5 h-5 flex-shrink-0" />个人中心
            </button>
            <a
              v-if="isAdmin"
              href="/docs/api"
              target="_blank"
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors no-underline"
              @click="closeMobileNav()"
            >
              <span class="i-lucide-file-code w-5 h-5 flex-shrink-0" />API 文档
            </a>
            <button
              v-if="isAdmin"
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              @click="goToSettings()"
            >
              <span class="i-lucide-shield w-5 h-5 flex-shrink-0" />系统设置
            </button>
            <button
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-500 hover:bg-red-50 transition-colors"
              @click="handleLogout"
            >
              <span class="i-lucide-log-out w-5 h-5 flex-shrink-0" />退出登录
            </button>
          </nav>
        </aside>
      </div>
    </Transition>
  </Teleport>

  <!-- 全局错误提示 -->
  <Teleport to="body">
    <div
      class="z-9999 fixed top-3 sm:top-5 right-3 sm:right-5 left-3 sm:left-auto flex flex-col gap-3"
    >
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="flex items-start gap-3 bg-white rounded-lg shadow-lg border border-red-200 border-l-4 border-l-red-500 px-4 py-3 max-w-full sm:max-w-96"
        >
          <span class="i-lucide-alert-circle w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p class="text-sm text-gray-700 leading-relaxed">{{ t.message }}</p>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style>
/* toast 进出动画 */
.toast-enter-active {
  transition: all 0.3s ease-out;
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(30px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

/* 移动端 Drawer 过渡动画 */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel {
  transition: transform 0.25s ease;
}
.drawer-enter-from .drawer-panel,
.drawer-leave-to .drawer-panel {
  transform: translateX(-100%);
}

/* 隐藏滚动条（用于横向滚动工具栏等） */
.scrollbar-none::-webkit-scrollbar {
  display: none;
}

@media print {
  @page {
    margin: 1.5cm;
  }
  /* 隐藏顶部导航 */
  header {
    display: none !important;
  }
  /* 移除内容区域的限制 */
  .flex-1.overflow-hidden {
    overflow: visible !important;
  }
  /* 隐藏所有浮层、下拉菜单、弹窗 */
  body > [style*='z-index'],
  .dialog-container,
  [class*='modal-overlay'] {
    display: none !important;
  }
}
</style>
