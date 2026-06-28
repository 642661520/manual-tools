import { ref } from 'vue'

/**
 * 响应式侧边栏抽屉状态管理。
 *
 * 供 Feature Editor、Catalog Builder、Manual Preview 等
 * 左右分栏页面在移动端/平板端切换侧边栏抽屉使用。
 */
export function useResponsiveSidebar() {
  const sidebarOpen = ref(false)

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function openSidebar() {
    sidebarOpen.value = true
  }

  function closeSidebar() {
    sidebarOpen.value = false
  }

  return { sidebarOpen, toggleSidebar, openSidebar, closeSidebar }
}
