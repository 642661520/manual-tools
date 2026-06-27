import type { Directive, DirectiveBinding } from 'vue'

interface TooltipState {
  text: string
  placement: 'top' | 'bottom'
  timer: ReturnType<typeof setTimeout> | null
  tooltipEl: HTMLDivElement | null
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFocus: () => void
  onBlur: () => void
  onScroll: () => void
  onResize: () => void
}

const stateMap = new WeakMap<HTMLElement, TooltipState>()

const GAP = 6
const VIEWPORT_MARGIN = 8
const SHOW_DELAY = 200

let tooltipIdCounter = 0

function createTooltipEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'tooltip')
  el.style.cssText = [
    'position: fixed',
    'z-index: 99999',
    'pointer-events: none',
    'background: #1f2937',
    'color: #fff',
    'font-size: 12px',
    'line-height: 1.4',
    'padding: 4px 8px',
    'border-radius: 8px',
    'box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
    'max-width: 200px',
    'word-break: break-word',
    'opacity: 0',
    'transition: opacity 0.15s ease',
  ].join(';')
  return el
}

function createArrow(placement: 'top' | 'bottom'): HTMLDivElement {
  const arrow = document.createElement('div')
  arrow.style.cssText = [
    'position: absolute',
    'left: 50%',
    'transform: translateX(-50%)',
    'width: 0',
    'height: 0',
    'border-left: 6px solid transparent',
    'border-right: 6px solid transparent',
    placement === 'top'
      ? 'top: 100%; border-top: 6px solid #1f2937'
      : 'bottom: 100%; border-bottom: 6px solid #1f2937',
  ].join(';')
  return arrow
}

function updateArrow(arrow: HTMLDivElement, placement: 'top' | 'bottom'): void {
  arrow.style.cssText = [
    'position: absolute',
    'left: 50%',
    'transform: translateX(-50%)',
    'width: 0',
    'height: 0',
    'border-left: 6px solid transparent',
    'border-right: 6px solid transparent',
    placement === 'top'
      ? 'top: 100%; border-top: 6px solid #1f2937'
      : 'bottom: 100%; border-bottom: 6px solid #1f2937',
  ].join(';')
}

function getPlacement(
  triggerRect: DOMRect,
  tooltipHeight: number,
  preferred: 'top' | 'bottom',
): 'top' | 'bottom' {
  if (preferred === 'top') {
    return triggerRect.top - tooltipHeight - GAP < 0 ? 'bottom' : 'top'
  }
  return triggerRect.bottom + tooltipHeight + GAP > window.innerHeight ? 'top' : 'bottom'
}

function positionTooltip(
  tooltipEl: HTMLDivElement,
  triggerEl: HTMLElement,
  placement: 'top' | 'bottom',
): void {
  const triggerRect = triggerEl.getBoundingClientRect()
  const tooltipRect = tooltipEl.getBoundingClientRect()

  // Horizontal: center over trigger, clamped to viewport
  let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN))

  // Vertical
  let top: number
  if (placement === 'top') {
    top = triggerRect.top - tooltipRect.height - GAP
  } else {
    top = triggerRect.bottom + GAP
  }

  tooltipEl.style.left = `${left}px`
  tooltipEl.style.top = `${top}px`
}

function showTooltip(state: TooltipState, el: HTMLElement): void {
  clearShowTimer(state)

  state.timer = setTimeout(() => {
    state.timer = null

    if (!state.tooltipEl) {
      state.tooltipEl = createTooltipEl()
      const arrow = createArrow(state.placement)
      state.tooltipEl.appendChild(arrow)
      document.body.appendChild(state.tooltipEl)
    }

    const arrow = state.tooltipEl.querySelector('div') as HTMLDivElement
    const actualPlacement = getPlacement(
      el.getBoundingClientRect(),
      state.tooltipEl.getBoundingClientRect().height || 24,
      state.placement,
    )
    state.placement = actualPlacement

    updateArrow(arrow, actualPlacement)
    state.tooltipEl.textContent = ''
    state.tooltipEl.appendChild(arrow)
    // Use a text node so arrow stays as DOM child
    state.tooltipEl.insertBefore(document.createTextNode(state.text), arrow)

    positionTooltip(state.tooltipEl, el, actualPlacement)
    state.tooltipEl.style.opacity = '1'
  }, SHOW_DELAY)
}

function hideTooltip(state: TooltipState): void {
  clearShowTimer(state)
  if (state.tooltipEl) {
    state.tooltipEl.style.opacity = '0'
  }
}

function clearShowTimer(state: TooltipState): void {
  if (state.timer !== null) {
    clearTimeout(state.timer)
    state.timer = null
  }
}

function destroyTooltip(state: TooltipState, triggerEl: HTMLElement): void {
  clearShowTimer(state)
  if (state.tooltipEl) {
    state.tooltipEl.remove()
    state.tooltipEl = null
  }
  triggerEl.removeAttribute('aria-describedby')
}

function ensureState(el: HTMLElement, binding: DirectiveBinding<string>): TooltipState {
  let state = stateMap.get(el)
  if (!state) {
    const placement = (binding.arg as 'top' | 'bottom') || 'top'

    const onMouseEnter = () => showTooltip(state!, el)
    const onMouseLeave = () => hideTooltip(state!)
    const onFocus = () => showTooltip(state!, el)
    const onBlur = () => hideTooltip(state!)
    const onScroll = () => hideTooltip(state!)
    const onResize = () => hideTooltip(state!)

    state = {
      text: binding.value ?? '',
      placement,
      timer: null,
      tooltipEl: null,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      onScroll,
      onResize,
    }
    stateMap.set(el, state)

    el.addEventListener('mouseenter', onMouseEnter)
    el.addEventListener('mouseleave', onMouseLeave)
    el.addEventListener('focus', onFocus)
    el.addEventListener('blur', onBlur)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
  }
  return state
}

export const vTooltip: Directive<HTMLElement, string> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<string>): void {
    const state = ensureState(el, binding)

    // Set ARIA
    const tooltipId = `tooltip-${++tooltipIdCounter}`
    el.setAttribute('aria-describedby', tooltipId)
    // Defer id assignment until tooltipEl is created; we store it on state
    ;(state as unknown as { tooltipId: string }).tooltipId = tooltipId
  },

  updated(el: HTMLElement, binding: DirectiveBinding<string>): void {
    const state = stateMap.get(el)
    if (!state) return

    const newText = binding.value ?? ''
    if (state.text !== newText) {
      state.text = newText
      // If currently showing, update text
      if (state.tooltipEl && state.tooltipEl.style.opacity === '1') {
        const arrow = state.tooltipEl.querySelector('div')
        state.tooltipEl.textContent = ''
        state.tooltipEl.appendChild(document.createTextNode(state.text))
        if (arrow) state.tooltipEl.appendChild(arrow)
        positionTooltip(state.tooltipEl, el, state.placement)
      }
    }

    // Update placement if arg changed
    const newPlacement = (binding.arg as 'top' | 'bottom') || 'top'
    if (state.placement !== newPlacement) {
      state.placement = newPlacement
    }
  },

  unmounted(el: HTMLElement): void {
    const state = stateMap.get(el)
    if (!state) return

    el.removeEventListener('mouseenter', state.onMouseEnter)
    el.removeEventListener('mouseleave', state.onMouseLeave)
    el.removeEventListener('focus', state.onFocus)
    el.removeEventListener('blur', state.onBlur)
    window.removeEventListener('scroll', state.onScroll, true)
    window.removeEventListener('resize', state.onResize)

    destroyTooltip(state, el)
    stateMap.delete(el)
  },
}
