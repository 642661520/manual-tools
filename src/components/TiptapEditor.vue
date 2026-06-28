<script setup lang="ts">
import { watch, ref, computed } from 'vue'
import { EditorContent } from '@tiptap/vue-3'
import { Selection } from '@tiptap/pm/state'
import { useTiptapYjs } from '@/composables/useTiptapYjs'
import { useYjsDoc } from '@/composables/useYjsDoc'
import { useDialog } from '@/composables/useDialog'
import TableGridPicker from './TableGridPicker.vue'
import TableBubbleMenu from './TableBubbleMenu.vue'
import CrossrefPicker from './CrossrefPicker.vue'
import ModalDialog from './ModalDialog.vue'
import SearchReplaceBar from './SearchReplaceBar.vue'
import MediaUploadDialog from './editor/MediaUploadDialog.vue'
import AiBubbleMenu from './editor/AiBubbleMenu.vue'
import type { CrossrefAttrs } from '@/composables/crossref-node'

const { alert, prompt } = useDialog()

// 链接弹窗（使用 ModalDialog，遵循项目现有表单弹窗模式）
const linkDialogVisible = ref(false)
const linkUrl = ref('')
const linkText = ref('')
let linkResolve: ((value: { url: string; displayText: string } | null) => void) | null = null

function openLinkDialog(
  url: string,
  text: string,
): Promise<{ url: string; displayText: string } | null> {
  return new Promise((resolve) => {
    linkResolve = resolve
    linkUrl.value = url
    linkText.value = text || url
    linkDialogVisible.value = true
  })
}

function onLinkConfirm() {
  linkDialogVisible.value = false
  linkResolve?.({
    url: linkUrl.value.trim(),
    displayText: linkText.value.trim() || linkUrl.value.trim(),
  })
  linkResolve = null
}

function onLinkCancel() {
  linkDialogVisible.value = false
  linkResolve?.(null)
  linkResolve = null
}

// 交叉引用
const crossrefPickerVisible = ref(false)
const crossrefCurrentId = ref<string | undefined>(undefined)

const props = defineProps<{
  docId: string
  editable?: boolean
  placeholder?: string
  findText?: string
}>()

const { ydoc, connected, synced, readOnly, awareness } = useYjsDoc(props.docId)
const { editor, initialSyncDone } = useTiptapYjs(ydoc, awareness, {
  editable: false,
  placeholder: props.placeholder,
})

// 同步完成后才根据 props.editable 和 readOnly 启用编辑
watch([synced, () => props.editable, readOnly], ([isSynced, edit, ro]) => {
  editor.value?.setEditable(isSynced && (edit ?? false) && !ro)
})

// 搜索跳转定位 — 用 Highlight 标记闪烁
watch([() => props.findText, synced, initialSyncDone], ([text, isSynced, done]) => {
  if (text && isSynced && done && editor.value) {
    const ed = editor.value
    setTimeout(() => {
      let found = false
      ed.state.doc.descendants((node, pos) => {
        if (found || !node.isText) return
        const idx = node.text!.indexOf(text)
        if (idx >= 0) {
          const from = pos + idx
          const to = from + text.length
          ed.commands.setTextSelection({ from, to })
          ed.commands.scrollIntoView()
          ed.commands.toggleHighlight({ color: '#fde047' })
          setTimeout(() => {
            ed.commands.setTextSelection({ from, to })
            ed.commands.toggleHighlight({ color: '#fde047' })
          }, 1500)
          found = true
        }
      })
    }, 500)
  }
})

// 查找替换
const searchVisible = ref(false)
const searchBarRef = ref<InstanceType<typeof SearchReplaceBar>>()

// 在线用户（从 awareness 中读取除自己以外的连接）
interface OnlineUser {
  name: string
  color: string
  avatar: string | null
}

const onlineUsers = ref<OnlineUser[]>([])

function updateOnlineUsers() {
  const states = awareness.getStates()
  const users: OnlineUser[] = []
  states.forEach((state, _clientId) => {
    if (state.user) {
      users.push(state.user as OnlineUser)
    }
  })
  onlineUsers.value = users
}
awareness.on('update', updateOnlineUsers)

function toggleSearch() {
  searchVisible.value = !searchVisible.value
  if (searchVisible.value) {
    searchBarRef.value?.focusSearch()
  }
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (searchVisible.value) {
      e.preventDefault()
      searchVisible.value = false
    } else if (isFullscreen.value) {
      e.preventDefault()
      isFullscreen.value = false
    }
  }
}

// 全屏写作
const isFullscreen = ref(false)
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

// 颜色选择器
const showColorPicker = ref<'text' | 'highlight' | null>(null)
const textColors = [
  '#000000',
  '#374151',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]
const highlightColors = [
  '#fef08a',
  '#fde68a',
  '#fca5a5',
  '#fdba74',
  '#86efac',
  '#93c5fd',
  '#c4b5fd',
  '#f9a8d4',
  '#d1d5db',
  '#e5e7eb',
]

function applyTextColor(color: string) {
  editor.value?.chain().focus().setColor(color).run()
  showColorPicker.value = null
}

function unsetTextColor() {
  editor.value?.chain().focus().unsetColor().run()
  showColorPicker.value = null
}

function applyHighlight(color: string) {
  editor.value?.chain().focus().toggleHighlight({ color }).run()
  showColorPicker.value = null
}

function unsetHighlight() {
  editor.value?.chain().focus().unsetHighlight().run()
  showColorPicker.value = null
}

// 图片/视频尺寸
const imageResizeVisible = ref(false)
const currentImageWidth = ref<number | null>(null)
const videoResizeVisible = ref(false)
const currentVideoWidth = ref<number | null>(null)
const mediaResizePresets = [25, 50, 75, 100]

function updateMediaState() {
  const ed = editor.value
  if (!props.editable || !ed) {
    imageResizeVisible.value = false
    currentImageWidth.value = null
    videoResizeVisible.value = false
    currentVideoWidth.value = null
    return
  }

  // 图片
  if (ed.isActive('image')) {
    const attrs = ed.getAttributes('image')
    const style = (attrs.imgStyle || attrs.style) as string | undefined
    if (style) {
      const m = style.match(/width:\s*(\d+)%/)
      currentImageWidth.value = m ? parseInt(m[1]) : null
    } else {
      currentImageWidth.value = null
    }
    imageResizeVisible.value = true
  } else {
    imageResizeVisible.value = false
    currentImageWidth.value = null
  }

  // 视频
  if (ed.isActive('video')) {
    const attrs = ed.getAttributes('video')
    currentVideoWidth.value = (attrs.width as number) || null
    videoResizeVisible.value = true
  } else {
    videoResizeVisible.value = false
    currentVideoWidth.value = null
  }
}

function setImageWidth(pct: number) {
  editor.value
    ?.chain()
    .focus()
    .updateAttributes('image', { imgStyle: `width: ${pct}%` })
    .run()
  currentImageWidth.value = pct
}

function resetImageWidth() {
  editor.value?.chain().focus().updateAttributes('image', { imgStyle: null }).run()
  currentImageWidth.value = null
}

function setVideoWidth(pct: number) {
  editor.value?.chain().focus().updateAttributes('video', { width: pct }).run()
  currentVideoWidth.value = pct
}

function resetVideoWidth() {
  editor.value?.chain().focus().updateAttributes('video', { width: null }).run()
  currentVideoWidth.value = null
}

// 检测图片/视频选中
watch(editor, (ed) => {
  if (!ed) return
  ed.on('selectionUpdate', updateMediaState)
})

// 底部状态栏
const charCount = computed(() => {
  return editor.value?.storage?.characterCount?.characters?.() ?? 0
})

const currentFormat = computed(() => {
  const ed = editor.value
  if (!ed) return ''
  if (ed.isActive('heading', { level: 1 })) return '标题1'
  if (ed.isActive('heading', { level: 2 })) return '标题2'
  if (ed.isActive('heading', { level: 3 })) return '标题3'
  if (ed.isActive('heading', { level: 4 })) return '标题4'
  if (ed.isActive('heading', { level: 5 })) return '标题5'
  if (ed.isActive('heading', { level: 6 })) return '标题6'
  if (ed.isActive('bulletList')) return '无序列表'
  if (ed.isActive('orderedList')) return '有序列表'
  if (ed.isActive('blockquote')) return '引用'
  if (ed.isActive('codeBlock')) return '代码块'
  if (ed.isActive('table')) return '表格'
  return '正文'
})

// 光标位置持久化
const cursorKey = () => `cursor:${props.docId}`
const hasRestoredCursor = ref(false)

// 保存选区（用 ProseMirror 原生序列化，比存原始 position 更稳定）
function saveSelection() {
  const ed = editor.value
  if (!ed || !hasRestoredCursor.value) return
  const json = JSON.stringify(ed.state.selection.toJSON())
  localStorage.setItem(cursorKey(), json)
}

// 恢复选区
function restoreSelection() {
  const ed = editor.value
  if (!ed) return false
  const saved = localStorage.getItem(cursorKey())
  if (!saved) {
    hasRestoredCursor.value = true
    return true
  }
  if (ed.state.doc.content.size <= 2) return false // 内容未加载

  try {
    const json = JSON.parse(saved)
    const sel = Selection.fromJSON(ed.state.doc, json)
    if (sel) {
      ed.view.dispatch(ed.state.tr.setSelection(sel).scrollIntoView())
      ed.commands.focus()
    }
  } catch {
    /* 选区位置对不上新文档，放弃 */
  }
  hasRestoredCursor.value = true
  return true
}

// 保存：editor 就绪后注册监听
watch(
  editor,
  (ed) => {
    if (!ed) return
    ed.on('selectionUpdate', saveSelection)
  },
  { immediate: true },
)

// 恢复：editor + connected 都就绪时尝试，内容未到则轮询
watch(
  [editor, connected],
  ([ed, isConnected]) => {
    if (ed && isConnected && !hasRestoredCursor.value) {
      tryRestoreWithRetry()
    }
  },
  { immediate: true },
)

function tryRestoreWithRetry() {
  if (restoreSelection()) return
  setTimeout(tryRestoreWithRetry, 200)
}

// 媒体上传（图片/视频统一组件）
const mediaType = ref<'image' | 'video'>('image')
const imageUploadVisible = ref(false)
const videoUploadVisible = ref(false)

function openImageDialog() {
  mediaType.value = 'image'
  imageUploadVisible.value = true
}

function openVideoDialog() {
  mediaType.value = 'video'
  videoUploadVisible.value = true
}

function onMediaInsert(result: { type: 'image' | 'video'; src: string }) {
  if (result.type === 'image') {
    editor.value?.chain().focus().setImage({ src: result.src }).run()
  } else {
    editor.value
      ?.chain()
      .focus()
      .insertContent({
        type: 'video',
        attrs: { src: result.src },
      })
      .run()
  }
}

// 链接
async function handleLink() {
  const ed = editor.value
  if (!ed) return

  const isLink = ed.isActive('link')
  const currentHref = isLink ? ed.getAttributes('link').href || '' : ''
  const hasSelection = !ed.state.selection.empty
  let selectedText = hasSelection
    ? ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to)
    : ''

  // 编辑已有链接时获取当前链接文字（预填到显示名称）
  if (!selectedText && isLink) {
    const { from } = ed.state.selection
    let linkFrom = from
    let linkTo = from
    ed.state.doc.nodesBetween(
      Math.max(0, from - 100),
      Math.min(ed.state.doc.content.size, from + 100),
      (node, pos) => {
        if (
          node.marks?.some((m) => m.type.name === 'link') &&
          pos <= from &&
          pos + (node.text?.length || 0) >= from
        ) {
          linkFrom = pos
          linkTo = pos + (node.text?.length || 0)
          return false
        }
      },
    )
    selectedText = ed.state.doc.textBetween(linkFrom, linkTo)
  }

  const result = await openLinkDialog(currentHref, selectedText)
  if (!result) return

  // 移除已有链接
  if (isLink) {
    ed.chain().focus().extendMarkRange('link').unsetLink().run()
  }

  const displayText = result.displayText || result.url

  if (ed.state.selection.empty || isLink) {
    const { from } = ed.state.selection
    ed.chain()
      .focus()
      .insertContent(displayText)
      .setTextSelection({ from, to: from + displayText.length })
      .setLink({ href: result.url })
      .run()
  } else {
    ed.chain().focus().setLink({ href: result.url }).run()
  }
}

// 交叉引用
function getCurrentCrossref(): {
  pos: number
  featureId: string
  label: string
  sectionKey: string
} | null {
  const ed = editor.value
  if (!ed) return null
  const { $from } = ed.state.selection
  if ($from.nodeBefore?.type.name === 'crossref') {
    const pos = $from.pos - $from.nodeBefore.nodeSize
    const attrs = $from.nodeBefore.attrs as CrossrefAttrs
    return {
      pos,
      featureId: attrs.featureId,
      label: attrs.label,
      sectionKey: attrs.sectionKey || '',
    }
  }
  if ($from.nodeAfter?.type.name === 'crossref') {
    const attrs = $from.nodeAfter.attrs as CrossrefAttrs
    return {
      pos: $from.pos,
      featureId: attrs.featureId,
      label: attrs.label,
      sectionKey: attrs.sectionKey || '',
    }
  }
  return null
}

const crossrefCurrentSectionKey = ref<string>('')

function openCrossrefPicker() {
  const ed = editor.value
  if (!ed) return
  const current = getCurrentCrossref()
  crossrefCurrentId.value = current?.featureId
  crossrefCurrentSectionKey.value = current?.sectionKey || ''
  crossrefPickerVisible.value = true
}

function onCrossrefSelect(
  featureId: string,
  label: string,
  sectionKey: string,
  _sectionTitle: string,
) {
  const ed = editor.value
  if (!ed) return
  const current = getCurrentCrossref()
  if (current) {
    ed.chain().focus().setNodeSelection(current.pos).deleteSelection().run()
  }
  ed.chain()
    .focus()
    .insertContent({
      type: 'crossref',
      attrs: { featureId, label, sectionKey },
    })
    .run()
  crossrefPickerVisible.value = false
}

function onCrossrefRemove() {
  const ed = editor.value
  if (!ed) return
  const current = getCurrentCrossref()
  if (current) {
    ed.chain().focus().setNodeSelection(current.pos).deleteSelection().run()
  }
  crossrefPickerVisible.value = false
}

defineExpose({ connected, synced, initialSyncDone, editor })
</script>

<template>
  <div
    v-if="editor"
    class="tiptap-editor h-full flex flex-col"
    :class="{ fullscreen: isFullscreen }"
  >
    <div
      v-if="editable && !readOnly"
      class="flex items-center gap-0.5 sm:gap-1 px-2 sm:px-4 py-1.5 sm:py-2 border-b border-gray-200 bg-white flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-visible scrollbar-none"
    >
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('bold') }"
        v-tooltip="'加粗'"
        @click="editor.chain().focus().toggleBold().run()"
      >
        <span class="i-lucide-bold w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('italic') }"
        v-tooltip="'斜体'"
        @click="editor.chain().focus().toggleItalic().run()"
      >
        <span class="i-lucide-italic w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('strike') }"
        v-tooltip="'删除线'"
        @click="editor.chain().focus().toggleStrike().run()"
      >
        <span class="i-lucide-strikethrough w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('underline') }"
        v-tooltip="'下划线'"
        @click="editor.chain().focus().toggleUnderline().run()"
      >
        <span class="i-lucide-underline w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('subscript') }"
        v-tooltip="'下标'"
        @click="editor.chain().focus().toggleSubscript().run()"
      >
        <span class="i-lucide-subscript w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('superscript') }"
        v-tooltip="'上标'"
        @click="editor.chain().focus().toggleSuperscript().run()"
      >
        <span class="i-lucide-superscript w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('code') }"
        v-tooltip="'行内代码'"
        @click="editor.chain().focus().toggleCode().run()"
      >
        <span class="i-lucide-code w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm relative"
        :class="{ 'bg-gray-200': showColorPicker === 'text' }"
        v-tooltip="'文字颜色'"
        @click="showColorPicker = showColorPicker === 'text' ? null : 'text'"
      >
        <span class="i-lucide-baseline w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm relative"
        :class="{ 'bg-gray-200': showColorPicker === 'highlight' }"
        v-tooltip="'高亮'"
        @click="showColorPicker = showColorPicker === 'highlight' ? null : 'highlight'"
      >
        <span class="i-lucide-highlighter w-4 h-4 inline-block align-middle" />
      </button>
      <div class="w-px h-4 sm:h-5 bg-gray-300 mx-0.5 sm:mx-1 hidden sm:block" />
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('link') }"
        v-tooltip="'链接'"
        @click="handleLink"
      >
        <span class="i-lucide-link w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('crossref') }"
        v-tooltip="'交叉引用'"
        @click="openCrossrefPicker"
      >
        <span class="i-lucide-bookmark w-4 h-4 inline-block align-middle" />
      </button>
      <div class="w-px h-4 sm:h-5 bg-gray-300 mx-0.5 sm:mx-1 hidden sm:block" />
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('heading', { level: 1 }) }"
        v-tooltip="'标题1'"
        @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
      >
        <span class="i-lucide-heading-1 w-5 h-5 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('heading', { level: 2 }) }"
        v-tooltip="'标题2'"
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
      >
        <span class="i-lucide-heading-2 w-5 h-5 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('heading', { level: 3 }) }"
        v-tooltip="'标题3'"
        @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
      >
        <span class="i-lucide-heading-3 w-5 h-5 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('heading', { level: 4 }) }"
        v-tooltip="'标题4'"
        @click="editor.chain().focus().toggleHeading({ level: 4 }).run()"
      >
        <span class="i-lucide-heading-4 w-5 h-5 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('heading', { level: 5 }) }"
        v-tooltip="'标题5'"
        @click="editor.chain().focus().toggleHeading({ level: 5 }).run()"
      >
        <span class="i-lucide-heading-5 w-5 h-5 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('heading', { level: 6 }) }"
        v-tooltip="'标题6'"
        @click="editor.chain().focus().toggleHeading({ level: 6 }).run()"
      >
        <span class="i-lucide-heading-6 w-5 h-5 inline-block align-middle" />
      </button>
      <div class="w-px h-4 sm:h-5 bg-gray-300 mx-0.5 sm:mx-1 hidden sm:block" />
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive({ textAlign: 'left' }) }"
        v-tooltip="'左对齐'"
        @click="editor.chain().focus().setTextAlign('left').run()"
      >
        <span class="i-lucide-align-left w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive({ textAlign: 'center' }) }"
        v-tooltip="'居中'"
        @click="editor.chain().focus().setTextAlign('center').run()"
      >
        <span class="i-lucide-align-center w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive({ textAlign: 'right' }) }"
        v-tooltip="'右对齐'"
        @click="editor.chain().focus().setTextAlign('right').run()"
      >
        <span class="i-lucide-align-right w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive({ textAlign: 'justify' }) }"
        v-tooltip="'两端对齐'"
        @click="editor.chain().focus().setTextAlign('justify').run()"
      >
        <span class="i-lucide-align-justify w-4 h-4 inline-block align-middle" />
      </button>
      <div class="w-px h-4 sm:h-5 bg-gray-300 mx-0.5 sm:mx-1 hidden sm:block" />
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('bulletList') }"
        v-tooltip="'无序列表'"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        <span class="i-lucide-list w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('orderedList') }"
        v-tooltip="'有序列表'"
        @click="editor.chain().focus().toggleOrderedList().run()"
      >
        1.
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('taskList') }"
        v-tooltip="'待办清单'"
        @click="editor.chain().focus().toggleTaskList().run()"
      >
        <span class="i-lucide-check-square w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('blockquote') }"
        v-tooltip="'引用'"
        @click="editor.chain().focus().toggleBlockquote().run()"
      >
        <span class="i-lucide-quote w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': editor.isActive('codeBlock') }"
        v-tooltip="'代码块'"
        @click="editor.chain().focus().toggleCodeBlock().run()"
      >
        <span class="i-lucide-code-xml w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        v-tooltip="'分隔线'"
        @click="editor.chain().focus().setHorizontalRule().run()"
      >
        <span class="i-lucide-minus w-4 h-4 inline-block align-middle" />
      </button>
      <div class="w-px h-4 sm:h-5 bg-gray-300 mx-0.5 sm:mx-1 hidden sm:block" />
      <TableGridPicker :editor="editor" :editable="editable ?? true" />
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        v-tooltip="'插入图片'"
        @click="openImageDialog"
      >
        <span class="i-lucide-image w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        v-tooltip="'插入视频'"
        @click="openVideoDialog"
      >
        <span class="i-lucide-film w-4 h-4 inline-block align-middle" />
      </button>
      <div class="w-px h-4 sm:h-5 bg-gray-300 mx-0.5 sm:mx-1 hidden sm:block" />
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': isFullscreen }"
        v-tooltip="'全屏写作'"
        @click="toggleFullscreen"
      >
        <span class="i-lucide-maximize w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        :class="{ 'bg-gray-200': searchVisible }"
        v-tooltip="'查找替换'"
        @click="toggleSearch"
      >
        <span class="i-lucide-search w-4 h-4 inline-block align-middle" />
      </button>

      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        v-tooltip="'撤销'"
        @click="editor.chain().focus().undo().run()"
      >
        <span class="i-lucide-undo-2 w-4 h-4 inline-block align-middle" />
      </button>
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        v-tooltip="'重做'"
        @click="editor.chain().focus().redo().run()"
      >
        <span class="i-lucide-redo-2 w-4 h-4 inline-block align-middle" />
      </button>
      <div class="w-px h-4 sm:h-5 bg-gray-300 mx-0.5 sm:mx-1 hidden sm:block" />
      <button
        class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded hover:bg-gray-100 text-sm"
        v-tooltip="'清除格式'"
        @click="editor.chain().focus().clearNodes().unsetAllMarks().run()"
      >
        <span class="i-lucide-remove-formatting w-4 h-4 inline-block align-middle" />
      </button>
    </div>

    <!-- 颜色选择器 -->
    <div
      v-if="showColorPicker"
      class="flex items-center gap-1 px-4 py-1.5 border-b border-gray-200 bg-white flex-wrap"
    >
      <template v-if="showColorPicker === 'text'">
        <button
          class="px-2 py-0.5 rounded border text-xs transition-colors border-gray-300 hover:bg-gray-100"
          @click="unsetTextColor"
        >
          默认
        </button>
        <button
          v-for="c in textColors"
          :key="c"
          class="w-6 h-6 rounded-full border border-gray-300 flex-shrink-0 hover:scale-110 transition-transform"
          :style="{ backgroundColor: c }"
          @click="applyTextColor(c)"
        />
      </template>
      <template v-else>
        <button
          class="px-2 py-0.5 rounded border text-xs transition-colors border-gray-300 hover:bg-gray-100"
          @click="unsetHighlight"
        >
          默认
        </button>
        <button
          v-for="c in highlightColors"
          :key="c"
          class="w-6 h-6 rounded-full border border-gray-300 flex-shrink-0 hover:scale-110 transition-transform"
          :style="{ backgroundColor: c }"
          @click="applyHighlight(c)"
        />
      </template>
    </div>

    <!-- 图片尺寸 -->
    <div
      v-if="imageResizeVisible && editable"
      class="flex items-center gap-2 px-4 py-1.5 border-b border-gray-200 bg-white text-sm"
    >
      <span class="text-xs text-gray-400">图片宽度：</span>
      <button
        class="px-2 py-0.5 rounded border text-xs transition-colors"
        :class="
          currentImageWidth === null
            ? 'bg-blue-100 border-blue-300 text-blue-700'
            : 'border-gray-300 hover:bg-gray-100'
        "
        @click="resetImageWidth"
      >
        默认
      </button>
      <button
        v-for="p in mediaResizePresets"
        :key="p"
        class="px-2 py-0.5 rounded border text-xs transition-colors"
        :class="
          currentImageWidth === p
            ? 'bg-blue-100 border-blue-300 text-blue-700'
            : 'border-gray-300 hover:bg-gray-100'
        "
        @click="setImageWidth(p)"
      >
        {{ p }}%
      </button>
      <span
        v-if="currentImageWidth && !mediaResizePresets.includes(currentImageWidth)"
        class="text-xs text-gray-400 ml-1"
      >
        当前 {{ currentImageWidth }}%
      </span>
    </div>

    <!-- 视频尺寸 -->
    <div
      v-if="videoResizeVisible && editable"
      class="flex items-center gap-2 px-4 py-1.5 border-b border-gray-200 bg-white text-sm"
    >
      <span class="text-xs text-gray-400">视频宽度：</span>
      <button
        class="px-2 py-0.5 rounded border text-xs transition-colors"
        :class="
          currentVideoWidth === null
            ? 'bg-blue-100 border-blue-300 text-blue-700'
            : 'border-gray-300 hover:bg-gray-100'
        "
        @click="resetVideoWidth"
      >
        默认
      </button>
      <button
        v-for="p in mediaResizePresets"
        :key="p"
        class="px-2 py-0.5 rounded border text-xs transition-colors"
        :class="
          currentVideoWidth === p
            ? 'bg-blue-100 border-blue-300 text-blue-700'
            : 'border-gray-300 hover:bg-gray-100'
        "
        @click="setVideoWidth(p)"
      >
        {{ p }}%
      </button>
      <span
        v-if="currentVideoWidth && !mediaResizePresets.includes(currentVideoWidth)"
        class="text-xs text-gray-400 ml-1"
      >
        当前 {{ currentVideoWidth }}%
      </span>
    </div>

    <TableBubbleMenu :editor="editor" />
    <AiBubbleMenu v-if="editor" :editor="editor" :editable="editable" />

    <CrossrefPicker
      :visible="crossrefPickerVisible"
      :current-feature-id="crossrefCurrentId"
      :current-section-key="crossrefCurrentSectionKey"
      @close="crossrefPickerVisible = false"
      @select="onCrossrefSelect"
      @remove="onCrossrefRemove"
    />

    <MediaUploadDialog
      :visible="imageUploadVisible"
      media-type="image"
      @update:visible="imageUploadVisible = $event"
      @insert="onMediaInsert"
    />

    <MediaUploadDialog
      :visible="videoUploadVisible"
      media-type="video"
      :max-size="100"
      @update:visible="videoUploadVisible = $event"
      @insert="onMediaInsert"
    />

    <ModalDialog
      :visible="linkDialogVisible"
      title="插入链接"
      confirm-text="确认"
      cancel-text="取消"
      @close="onLinkCancel"
      @confirm="onLinkConfirm"
    >
      <div class="space-y-3">
        <div>
          <label class="text-xs text-gray-500 mb-1 block">链接地址</label>
          <input
            v-model="linkUrl"
            class="input text-sm"
            placeholder="https://..."
            @keyup.enter="onLinkConfirm"
          />
        </div>
        <div>
          <label class="text-xs text-gray-500 mb-1 block">显示名称</label>
          <input
            v-model="linkText"
            class="input text-sm"
            placeholder="链接显示文字"
            @keyup.enter="onLinkConfirm"
          />
        </div>
      </div>
    </ModalDialog>

    <SearchReplaceBar
      v-if="searchVisible"
      ref="searchBarRef"
      :editor="editor"
      @close="searchVisible = false"
    />

    <div class="editor-print-content flex-1 overflow-y-auto relative" @keydown="onEsc">
      <div
        v-if="!synced"
        class="absolute inset-0 flex items-center justify-center bg-gray-50/80 z-10"
      >
        <div class="text-center text-gray-400">
          <span class="i-lucide-loader-2 w-6 h-6 inline-block animate-spin mb-2" />
          <p class="text-sm">正在加载文档...</p>
        </div>
      </div>
      <EditorContent
        :editor="editor"
        class="prose max-w-none p-3 sm:p-5 lg:p-8 min-h-full focus:outline-none"
      />
    </div>

    <!-- 底部状态栏 -->
    <div
      class="flex items-center justify-between px-2 sm:px-4 py-1 border-t border-gray-200 bg-gray-50 text-xs text-gray-400 select-none"
    >
      <span>{{ charCount }} 字符</span>
      <div class="flex items-center gap-1.5">
        <!-- 只读标记 -->
        <span
          v-if="readOnly"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded text-orange-600 bg-orange-50 border border-orange-200"
          v-tooltip="'当前项目已锁定为只读模式，仅供查阅'"
        >
          <span class="i-lucide-eye w-3 h-3" />
          只读
        </span>
        <!-- 在线用户头像 -->
        <div v-if="onlineUsers.length > 0" class="flex items-center gap-1 mr-3">
          <template v-for="(u, i) in onlineUsers" :key="i">
            <div
              v-if="u.avatar"
              class="w-5 h-5 rounded-full flex-shrink-0 bg-cover bg-center"
              v-tooltip="u.name"
              :style="{
                backgroundImage: `url(${u.avatar})`,
                backgroundColor: u.color,
                boxShadow: `0 0 0 1.5px ${u.color}`,
              }"
            />
            <div
              v-else
              class="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[11px] font-semibold"
              v-tooltip="u.name"
              :style="{ backgroundColor: u.color, boxShadow: `0 0 0 1.5px ${u.color}` }"
            >
              {{ u.name[0] || '?' }}
            </div>
          </template>
        </div>
        <span>{{ currentFormat }}</span>
      </div>
    </div>
  </div>
  <div v-else class="flex items-center justify-center h-full text-gray-400">编辑器加载中...</div>
</template>

<style>
.tiptap-editor .ProseMirror {
  min-height: 100%;
  outline: none;
  font-size: 15px;
  line-height: 1.75;
}
.tiptap-editor .ProseMirror h1 {
  font-size: 2em;
  font-weight: 700;
  margin: 0.67em 0;
}
.tiptap-editor .ProseMirror h2 {
  font-size: 1.5em;
  font-weight: 600;
  margin: 0.75em 0 0.5em;
}
.tiptap-editor .ProseMirror h3 {
  font-size: 1.17em;
  font-weight: 600;
  margin: 0.83em 0 0.5em;
}
.tiptap-editor .ProseMirror h4 {
  font-size: 1em;
  font-weight: 600;
  margin: 0.75em 0 0.5em;
}
.tiptap-editor .ProseMirror h5 {
  font-size: 0.9em;
  font-weight: 600;
  margin: 0.67em 0 0.5em;
}
.tiptap-editor .ProseMirror h6 {
  font-size: 0.83em;
  font-weight: 600;
  color: #6b7280;
  margin: 0.58em 0 0.5em;
}
.tiptap-editor .ProseMirror p {
  margin: 0.5em 0;
}
.tiptap-editor .ProseMirror ul {
  list-style: disc;
  padding-left: 1.5em;
}
.tiptap-editor .ProseMirror ol {
  list-style: decimal;
  padding-left: 1.5em;
}
.tiptap-editor .ProseMirror blockquote {
  border-left: 3px solid #d1d5db;
  padding-left: 1em;
  color: #6b7280;
  margin: 0.5em 0;
}
.tiptap-editor .ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
}
.tiptap-editor .ProseMirror th,
.tiptap-editor .ProseMirror td {
  border: 1px solid #d1d5db;
  padding: 0.5em 0.75em;
  text-align: left;
}
.tiptap-editor .ProseMirror th {
  background: #f3f4f6;
  font-weight: 600;
}
.tiptap-editor .ProseMirror pre {
  background: #1f2937;
  color: #f9fafb;
  padding: 0.75em 1em;
  border-radius: 0.5em;
  font-family: monospace;
  font-size: 0.875em;
}
.tiptap-editor .ProseMirror code {
  background: #f3f4f6;
  padding: 0.15em 0.3em;
  border-radius: 0.25em;
  font-size: 0.875em;
}
.tiptap-editor .ProseMirror pre code {
  background: none;
  padding: 0;
  color: inherit;
}
.tiptap-editor .ProseMirror img {
  max-width: 100%;
  border-radius: 0.5em;
}
.tiptap-editor .ProseMirror p.is-editor-empty:first-child::before {
  color: #adb5bd;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
.tiptap-editor .ProseMirror .selectedCell {
  background: rgba(59, 130, 246, 0.1);
}
.tiptap-editor .ProseMirror a {
  color: #2563eb;
  text-decoration: underline;
  cursor: pointer;
}
.tiptap-editor .ProseMirror crossref {
  color: #2563eb;
  background: #eff6ff;
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
  font-size: 0.9em;
  white-space: nowrap;
}
.tiptap-editor .ProseMirror .ProseMirror-selectednode crossref {
  outline: 2px solid #3b82f6;
  outline-offset: 1px;
}

/* 待办清单 */
.tiptap-editor .ProseMirror ul[data-type='taskList'] {
  list-style: none;
  padding-left: 0;
}
.tiptap-editor .ProseMirror ul[data-type='taskList'] li {
  display: flex;
  align-items: flex-start;
  gap: 0.4em;
  margin: 0.15em 0;
}
.tiptap-editor .ProseMirror ul[data-type='taskList'] li > label {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  min-height: 1.75em;
  cursor: pointer;
}
.tiptap-editor .ProseMirror ul[data-type='taskList'] li > label input[type='checkbox'] {
  width: 0.95em;
  height: 0.95em;
  margin: 0;
  accent-color: #3b82f6;
  cursor: pointer;
}
.tiptap-editor .ProseMirror ul[data-type='taskList'] li[data-checked='true'] > div > p {
  text-decoration: line-through;
  color: #9ca3af;
}

.tiptap-editor .ProseMirror hr {
  border: none;
  border-top: 2px solid #d1d5db;
  margin: 1.5em 0;
}

/* 全屏写作 */
.tiptap-editor.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: #fff;
}

/* 查找替换高亮 */
.tiptap-editor .ProseMirror .search-match {
  background: #fef08a;
}
.tiptap-editor .ProseMirror .search-match-current {
  background: #f59e0b;
  color: #fff;
}

/* 协同光标样式 */
.tiptap-editor .collaboration-cursor__caret {
  border-left: 1px solid;
  border-right: 1px solid;
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}
.tiptap-editor .collaboration-cursor__label {
  border-radius: 3px 3px 3px 0;
  color: #fff;
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  left: -1px;
  line-height: normal;
  padding: 1px 4px;
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
}

/* 打印样式 */
@media print {
  .tiptap-editor {
    position: static !important;
    background: #fff !important;
  }
  .tiptap-editor > *:not(.editor-print-content) {
    display: none !important;
  }
  .editor-print-content {
    overflow: visible !important;
    flex: none !important;
  }
  .editor-print-content > div[class*='absolute'] {
    display: none !important;
  }
  .tiptap-editor .ProseMirror {
    padding: 0 !important;
  }
}
</style>
