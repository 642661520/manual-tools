<script setup lang="ts">
import { ref, watch } from 'vue'
import { getChapter, getVersionChapter } from '@/api/endpoints/catalogs'
import type { ChapterResponse, CatalogEntry } from '@shared/types'
import type { SidebarNode, SidebarChapter, SidebarPart } from '@/composables/useSidebarTree'

const props = defineProps<{
  catalogId: string | null
  versionId: string | null
  previewMode: 'all' | 'approved'
  chNum: number | null
  totalChapters: number
  // 封面数据
  catalogTitle: string
  tree: SidebarNode[]
  hasParts: boolean
  changelog: Array<{ id: string; versionMajor: number; versionMinor: number; createdAt: string; changeNotes: string }>
  selectedVersionId: string | null
  onSelectVersion: (id: string | null) => void
}>()

const emit = defineEmits<{
  navigate: [chNum: number, anchorId?: string]
}>()

const loading = ref(false)
const chapter = ref<ChapterResponse | null>(null)
const error = ref('')
const contentRef = ref<HTMLElement>()

async function loadChapter() {
  if (!props.catalogId || !props.chNum || props.chNum < 1) {
    chapter.value = null
    return
  }
  loading.value = true
  error.value = ''
  try {
    const mode = props.previewMode === 'approved' ? 'approved' : undefined
    if (props.versionId) {
      chapter.value = await getVersionChapter(props.catalogId, props.versionId, props.chNum, mode)
    } else {
      chapter.value = await getChapter(props.catalogId, props.chNum, mode)
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '加载失败'
    chapter.value = null
  } finally {
    loading.value = false
  }
}

// 章节变化时重新加载
watch(() => [props.catalogId, props.versionId, props.chNum, props.previewMode], () => {
  loadChapter()
}, { immediate: true })

// 章节切换后滚动到顶部
watch(() => props.chNum, () => {
  if (contentRef.value) contentRef.value.scrollTop = 0
})

// 渲染 markdown
function renderHtml(md: string): string {
  if (!md) return '<p class="text-gray-400">（暂未编写）</p>'
  let html = md
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>')
  html = '<p>' + html + '</p>'
  html = html.replace(/<p><h([1-4])>/g, '<h$1>').replace(/<\/h([1-4])><\/p>/g, '</h$1>')
  html = html.replace(/<p><hr><\/p>/g, '<hr>')
  html = html.replace(/<p><blockquote>/g, '<blockquote>').replace(/<\/blockquote><\/p>/g, '</blockquote>')
  html = html.replace(/<p><(ul|ol|pre)\b/g, '<$1').replace(/<\/(ul|ol|pre)>\s*<\/p>/g, '</$1>')
  return html
}

// 拦截交叉引用链接点击
function onContentClick(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('a[href^="#ch"]')
  if (!link) return
  const href = link.getAttribute('href')!
  const match = href.match(/^#ch(\d+)(?:-s(\d+))?/)
  if (!match) return
  const targetCh = parseInt(match[1])
  if (targetCh === props.chNum) return
  e.preventDefault()
  const anchorId = match[2] ? `ch${targetCh}-s${match[2]}` : undefined
  emit('navigate', targetCh, anchorId)
}

function isCoverPart(node: SidebarNode): node is SidebarPart {
  return node.type === 'part'
}
</script>

<template>
  <div ref="contentRef" class="flex-1 overflow-y-auto">
    <div class="max-w-3xl mx-auto py-8 px-6">
      <!-- 封面页 -->
      <template v-if="chNum === 0">
        <div class="bg-white rounded-xl shadow-sm p-8">
          <h1 class="text-2xl font-bold mb-2">{{ catalogTitle }}</h1>
          <p class="text-sm text-gray-400 mb-6">{{ new Date().toISOString().slice(0, 10) }}</p>

          <!-- 变更记录 -->
          <div v-if="changelog.length > 0" class="mb-8">
            <h2 class="text-lg font-semibold mb-3">变更记录</h2>
            <div class="space-y-1 text-sm">
              <div
                v-for="v in changelog" :key="v.id"
                class="flex items-center gap-2 py-1 cursor-pointer hover:text-blue-600"
                :class="v.id === selectedVersionId ? 'text-blue-600' : 'text-gray-600'"
                @click="onSelectVersion(v.id)"
              >
                <span class="font-mono text-gray-400 flex-shrink-0">v{{ v.versionMajor }}.{{ v.versionMinor }}</span>
                <span class="text-gray-300 flex-shrink-0">{{ v.createdAt.slice(0, 10) }}</span>
                <span>{{ v.changeNotes || '（无变更说明）' }}</span>
              </div>
            </div>
          </div>

          <!-- 目录 -->
          <h2 class="text-lg font-semibold mb-3">目录</h2>
          <div class="text-sm">
            <template v-for="node in tree" :key="isCoverPart(node) ? node.id : node.featureId">
              <template v-if="isCoverPart(node)">
                <div class="font-semibold text-gray-700 mt-3 mb-1">
                  {{ (node as SidebarPart).title }}
                </div>
                <div v-for="ch in (node as SidebarPart).children" :key="ch.featureId" class="pl-4">
                  <div
                    class="py-0.5 cursor-pointer hover:text-blue-600 text-gray-700"
                    @click="emit('navigate', ch.chNum)"
                  >
                    <span class="font-mono text-gray-400 mr-2">{{ ch.chNum }}</span>
                    <span>{{ ch.title }}</span>
                  </div>
                  <template v-if="!ch.isLeaf">
                    <div
                      v-for="(sec, i) in ch.sections"
                      :key="sec.key"
                      class="pl-8 py-0.5 cursor-pointer hover:text-blue-600 text-gray-500 text-xs"
                      @click="emit('navigate', ch.chNum, sec.anchorId)"
                    >
                      {{ ch.chNum }}.{{ i + 1 }} {{ sec.title }}
                    </div>
                  </template>
                </div>
              </template>
              <div v-else class="pl-4">
                <div
                  class="py-0.5 cursor-pointer hover:text-blue-600 text-gray-700"
                  @click="emit('navigate', (node as SidebarChapter).chNum)"
                >
                  <span class="font-mono text-gray-400 mr-2">{{ (node as SidebarChapter).chNum }}</span>
                  <span>{{ (node as SidebarChapter).title }}</span>
                </div>
                <template v-if="!(node as SidebarChapter).isLeaf">
                  <div
                    v-for="(sec, i) in (node as SidebarChapter).sections"
                    :key="sec.key"
                    class="pl-8 py-0.5 cursor-pointer hover:text-blue-600 text-gray-500 text-xs"
                    @click="emit('navigate', (node as SidebarChapter).chNum, sec.anchorId)"
                  >
                    {{ (node as SidebarChapter).chNum }}.{{ i + 1 }} {{ sec.title }}
                  </div>
                </template>
              </div>
            </template>
          </div>
        </div>
      </template>

      <!-- Loading -->
      <div v-else-if="loading" class="bg-white rounded-xl shadow-sm p-8 flex items-center justify-center">
        <span class="i-lucide-loader-2 w-5 h-5 inline-block align-middle animate-spin text-blue-400 mr-2" />
        <span class="text-sm text-gray-400">加载章节...</span>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="bg-white rounded-xl shadow-sm p-8 text-center text-red-400 text-sm">
        {{ error }}
      </div>

      <!-- 章节内容 -->
      <template v-else-if="chapter">
        <div class="bg-white rounded-xl shadow-sm p-8">
          <div class="manual-content" v-html="renderHtml(chapter.markdown)" @click="onContentClick" />
        </div>

        <!-- 上一章 / 下一章 导航 -->
        <div v-if="totalChapters > 1" class="flex items-center justify-between mt-6">
          <button
            class="btn-secondary text-sm flex items-center gap-1"
            :disabled="chNum! <= 1"
            :class="{ 'opacity-40 cursor-not-allowed': chNum! <= 1 }"
            @click="emit('navigate', chNum! - 1)"
          >
            <span class="i-lucide-chevron-left w-4 h-4 inline-block align-middle" />
            上一章
          </button>
          <span class="text-xs text-gray-400">{{ chNum }} / {{ totalChapters }}</span>
          <button
            class="btn-secondary text-sm flex items-center gap-1"
            :disabled="chNum! >= totalChapters"
            :class="{ 'opacity-40 cursor-not-allowed': chNum! >= totalChapters }"
            @click="emit('navigate', chNum! + 1)"
          >
            下一章
            <span class="i-lucide-chevron-right w-4 h-4 inline-block align-middle" />
          </button>
        </div>
      </template>

      <!-- No chapter selected -->
      <div v-else class="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400 text-sm">
        请从左侧目录选择章节
      </div>
    </div>
  </div>
</template>

<style scoped>
.manual-content :deep(*) { overflow-wrap: break-word; word-break: break-all; }
.manual-content :deep(h1) { font-size: 1.75rem; font-weight: 700; margin: 1.5em 0 0.5em; }
.manual-content :deep(h2) { font-size: 1.25rem; font-weight: 600; margin: 1.25em 0 0.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25em; }
.manual-content :deep(h3) { font-size: 1.1rem; font-weight: 600; margin: 1em 0 0.5em; }
.manual-content :deep(h4) { font-size: 1rem; font-weight: 600; margin: 0.75em 0 0.5em; }
.manual-content :deep(p) { margin: 0.5em 0; line-height: 1.8; }
.manual-content :deep(blockquote) { border-left: 3px solid #d1d5db; padding-left: 1em; color: #6b7280; margin: 0.5em 0; }
.manual-content :deep(code) { background: #f3f4f6; padding: 0.15em 0.3em; border-radius: 0.25em; font-size: 0.875em; }
.manual-content :deep(pre) { overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
.manual-content :deep(hr) { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }
.manual-content :deep(strong) { font-weight: 600; }
.manual-content :deep(em) { font-style: italic; }
.manual-content :deep(a) { color: #2563eb; text-decoration: none; }
.manual-content :deep(a:hover) { text-decoration: underline; }
.manual-content :deep(table) { border-collapse: collapse; width: 100%; margin: 0.75em 0; table-layout: fixed; }
.manual-content :deep(th) { background: #f3f4f6; font-weight: 600; border: 1px solid #d1d5db; padding: 0.5em 0.75em; text-align: left; }
.manual-content :deep(td) { border: 1px solid #d1d5db; padding: 0.5em 0.75em; overflow-wrap: break-word; }
.manual-content :deep(.crossref-link) { color: #2563eb; background: #eff6ff; padding: 0.1em 0.4em; border-radius: 0.25em; font-size: 0.9em; text-decoration: none; white-space: nowrap; }
.manual-content :deep(.crossref-link:hover) { text-decoration: underline; background: #dbeafe; }
</style>
