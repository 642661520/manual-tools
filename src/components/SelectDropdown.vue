<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import UserAvatar from '@/components/UserAvatar.vue'

export interface SelectOption {
  value: string | number | null
  label: string
  disabled?: boolean
  avatar?: string
  name?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
    widthClass?: string
    btnClass?: string
  }>(),
  {
    placeholder: '请选择',
    disabled: false,
    widthClass: 'w-full',
    btnClass: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
}>()

const isOpen = ref(false)
const highlightIndex = ref(-1)
const triggerRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref<Record<string, string>>({})

const selectedOption = computed(() => props.options.find((o) => o.value === props.modelValue))

const selectedLabel = computed(() => {
  return selectedOption.value ? selectedOption.value.label : props.placeholder
})

function open() {
  if (props.disabled) return
  isOpen.value = true
  const initIndex = props.options.findIndex((o) => !o.disabled)
  highlightIndex.value = initIndex >= 0 ? initIndex : 0
  nextTick(updateDropdownPosition)
}

function close() {
  isOpen.value = false
  highlightIndex.value = -1
}

function toggle() {
  if (isOpen.value) {
    close()
  } else {
    open()
  }
}

function select(opt: SelectOption) {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  close()
  triggerRef.value?.focus()
}

function updateDropdownPosition() {
  if (!isOpen.value || !triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const estimatedHeight = Math.min(props.options.length * 40 + 8, 240)

  dropdownStyle.value = {
    left: `${rect.left}px`,
    width: `${rect.width}px`,
  }

  if (
    rect.bottom + estimatedHeight <= window.innerHeight ||
    (rect.bottom + estimatedHeight > window.innerHeight &&
      rect.top > window.innerHeight - rect.bottom)
  ) {
    // Place below
    dropdownStyle.value.top = `${rect.bottom + 4}px`
  } else {
    // Place above
    dropdownStyle.value.bottom = `${window.innerHeight - rect.top + 4}px`
  }
}

function handleTriggerKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault()
    open()
  }
}

function handlePanelKeydown(e: KeyboardEvent) {
  if (props.options.length === 0) return

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      highlightIndex.value = Math.min(highlightIndex.value + 1, props.options.length - 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      highlightIndex.value = Math.max(highlightIndex.value - 1, 0)
      break
    case 'Enter':
    case ' ': {
      e.preventDefault()
      const item = props.options[highlightIndex.value]
      if (item && !item.disabled) select(item)
      break
    }
    case 'Escape':
      e.preventDefault()
      close()
      triggerRef.value?.focus()
      break
    case 'Tab':
      close()
      break
  }
}

function onClickOutside(e: MouseEvent) {
  if (!isOpen.value) return
  const target = e.target as Node
  if (dropdownRef.value?.contains(target)) return
  if (triggerRef.value?.contains(target)) return
  close()
}

function onReposition() {
  if (isOpen.value) updateDropdownPosition()
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  window.addEventListener('scroll', onReposition, true)
  window.addEventListener('resize', onReposition)
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener('scroll', onReposition, true)
  window.removeEventListener('resize', onReposition)
})
</script>

<template>
  <div ref="dropdownRef" class="relative" :class="widthClass">
    <!-- 触发器 -->
    <button
      ref="triggerRef"
      type="button"
      class="w-full border border-gray-300 rounded-lg bg-white text-left flex items-center justify-between gap-2 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      :class="[
        btnClass || 'px-3 py-2 text-sm',
        { 'ring-2 ring-blue-500 border-transparent': isOpen },
      ]"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      @click="toggle"
      @keydown="handleTriggerKeydown"
    >
      <span
        class="truncate flex items-center gap-2"
        :class="modelValue === null || modelValue === '' ? 'text-gray-400' : 'text-gray-700'"
      >
        <UserAvatar
          v-if="selectedOption?.avatar || selectedOption?.name"
          :avatar-url="selectedOption?.avatar"
          :name="selectedOption?.name"
          size="2xs"
        />
        <span class="truncate">{{ selectedLabel }}</span>
      </span>
      <span
        class="i-lucide-chevron-down w-4 h-4 text-gray-400 flex-shrink-0 inline-block align-middle transition-transform duration-200"
        :class="{ 'rotate-180': isOpen }"
      />
    </button>

    <!-- 下拉面板 (Teleport 到 body 以突破 z-index 和 overflow 限制) -->
    <Teleport to="body">
      <Transition name="dropdown">
        <div
          v-if="isOpen"
          class="fixed z-[9999] bg-white rounded-xl shadow-lg border border-gray-200 py-1 overflow-y-auto max-h-60"
          :style="dropdownStyle"
          role="listbox"
          @keydown="handlePanelKeydown"
        >
          <div
            v-for="(opt, idx) in options"
            :key="String(opt.value)"
            class="px-3 py-2 text-sm cursor-pointer flex items-center justify-between transition-colors"
            :class="[
              opt.value === modelValue
                ? 'bg-blue-50 text-blue-700 font-medium'
                : highlightIndex === idx
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-700 hover:bg-gray-50',
              opt.disabled ? 'opacity-40 cursor-not-allowed' : '',
            ]"
            :aria-selected="opt.value === modelValue"
            role="option"
            @click="select(opt)"
            @mouseenter="highlightIndex = idx"
          >
            <span class="truncate flex items-center gap-2">
              <UserAvatar
                v-if="opt.avatar || opt.name"
                :avatar-url="opt.avatar"
                :name="opt.name"
                size="2xs"
              />
              <span class="truncate">{{ opt.label }}</span>
            </span>
            <span
              v-if="opt.value === modelValue"
              class="i-lucide-check w-4 h-4 text-blue-600 flex-shrink-0 ml-2 inline-block align-middle"
            />
          </div>
          <div v-if="options.length === 0" class="px-3 py-4 text-sm text-gray-400 text-center">
            无可用选项
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.dropdown-enter-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.dropdown-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
