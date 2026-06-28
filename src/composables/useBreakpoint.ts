import { ref, computed, onMounted, onUnmounted } from 'vue'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

/**
 * 响应式断点侦听，基于 matchMedia 监听窗口宽度。
 *
 * - mobile:  < 768px （手机）
 * - tablet:  768px - 1023px （平板）
 * - desktop: >= 1024px （桌面）
 */
export function useBreakpoint() {
  const width = ref(window.innerWidth)

  const breakpoint = computed<Breakpoint>(() => {
    if (width.value < 768) return 'mobile'
    if (width.value < 1024) return 'tablet'
    return 'desktop'
  })

  const isMobile = computed(() => breakpoint.value === 'mobile')
  const isTablet = computed(() => breakpoint.value === 'tablet')
  const isDesktop = computed(() => breakpoint.value === 'desktop')

  let rafId = 0

  function onResize() {
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      width.value = window.innerWidth
    })
  }

  onMounted(() => window.addEventListener('resize', onResize))
  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
    cancelAnimationFrame(rafId)
  })

  return { width, breakpoint, isMobile, isTablet, isDesktop }
}
