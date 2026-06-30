<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { getChapter, getVersionChapter } from '@/api/endpoints/catalogs'
import type { ChapterResponse } from '@shared/types'
import type { SidebarNode, SidebarChapter, SidebarPart } from '@/composables/useSidebarTree'
import { getTitleHash, getCoverColors } from '@/composables/useCoverColors'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  catalogId: string | null
  versionId: string | null
  previewMode: 'all' | 'approved'
  chNum: number | null
  totalChapters: number
  // 封面数据
  catalogTitle: string
  coverInfo?: Record<string, unknown>
  tree: SidebarNode[]
  hasParts: boolean
  changelog: Array<{
    id: string
    versionMajor: number
    versionMinor: number
    createdAt: string
    changeNotes: string
    publishScope?: string
  }>
  selectedVersionId: string | null
  onSelectVersion: (id: string | null) => void
}>()

const emit = defineEmits<{
  navigate: [payload: { chNum: number; anchorId?: string }]
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
watch(
  () => [props.catalogId, props.versionId, props.chNum, props.previewMode],
  () => {
    loadChapter()
  },
  { immediate: true },
)

// 章节切换后滚动到顶部
watch(
  () => props.chNum,
  () => {
    if (contentRef.value) contentRef.value.scrollTop = 0
  },
)

// 渲染 markdown（使用 markdown-it，支持表格/代码块/图片等）
function renderHtml(md: string): string {
  return renderMarkdown(md)
}

// 最新发布版本号（用于封面显示）
const latestPublishedVersion = computed(() => {
  if (props.changelog.length === 0) return ''
  const latest = props.changelog[0]
  return `v${latest.versionMajor}.${latest.versionMinor}`
})

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
  emit('navigate', { chNum: targetCh, anchorId })
}

function isCoverPart(node: SidebarNode): node is SidebarPart {
  return node.type === 'part'
}

// ====== 右侧页内目录 ======

interface TocItem {
  level: number
  text: string
  id: string
}

const tocItems = ref<TocItem[]>([])
const activeTocId = ref<string | null>(null)
let tocObserver: IntersectionObserver | null = null

/** 从渲染后的 DOM 中提取所有标题（匹配静态站 TOC 逻辑） */
function extractHeadingsFromDom(): TocItem[] {
  if (!contentRef.value) return []
  const container = contentRef.value.querySelector('.manual-content')
  if (!container) return []

  const headingEls = container.querySelectorAll('h2, h3, h4')
  const items: TocItem[] = []
  const seen = new Set<string>()

  headingEls.forEach((el, i) => {
    const text = el.textContent?.trim() || ''
    if (!text || seen.has(text)) return
    seen.add(text)

    // 过滤结构性标题：Part（part-N）和 Chapter（chN，无 -s 后缀）
    // ID 可能在 <a> 子元素上，如 <h2><a id="part-1"></a>标题</h2>
    const anchor = el.querySelector('a[id]')
    const anchorId = anchor?.id || ''
    if (/^part-\d+$/.test(anchorId) || /^ch\d+$/.test(anchorId)) return

    // 用已有 ID（h 元素自身或子 <a>），都没有则自动生成
    let id = el.id || anchorId
    if (!id) {
      id = 'toc-h' + i
      el.id = id
    }

    items.push({
      level: parseInt(el.tagName[1]),
      text,
      id,
    })
  })

  return items
}

/** 章节内容渲染后提取标题并重建 observer */
function refreshToc() {
  nextTick(() => {
    tocItems.value = extractHeadingsFromDom()
    destroyTocObserver()
    if (tocItems.value.length === 0) return

    const targets = tocItems.value
      .map((item) => document.getElementById(item.id))
      .filter(Boolean) as HTMLElement[]
    if (targets.length === 0) return

    tocObserver = new IntersectionObserver(
      (entries) => {
        let visibleTop = Infinity
        let visibleId: string | null = null
        for (const entry of entries) {
          if (entry.isIntersecting && entry.boundingClientRect.top < visibleTop) {
            visibleTop = entry.boundingClientRect.top
            visibleId = entry.target.id
          }
        }
        if (visibleId) {
          activeTocId.value = visibleId
        } else {
          let closestId: string | null = null
          let closestDist = Infinity
          for (const item of tocItems.value) {
            const el = document.getElementById(item.id)
            if (!el) continue
            const rect = el.getBoundingClientRect()
            if (rect.top <= 120 && Math.abs(rect.top - 120) < closestDist) {
              closestDist = Math.abs(rect.top - 120)
              closestId = item.id
            }
          }
          activeTocId.value = closestId
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    )

    for (const el of targets) {
      tocObserver.observe(el)
    }
  })
}

function destroyTocObserver() {
  if (tocObserver) {
    tocObserver.disconnect()
    tocObserver = null
  }
}

function scrollToHeading(id: string) {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    activeTocId.value = id
  }
}

// 章节内容变化后重建 TOC
watch(
  () => chapter.value?.markdown,
  () => {
    activeTocId.value = null
    refreshToc()
  },
)

onMounted(() => {
  refreshToc()
})

onUnmounted(() => {
  destroyTocObserver()
})
</script>

<template>
  <div ref="contentRef" class="flex-1 overflow-y-auto">
    <!-- 封面页 -->
    <template v-if="chNum === 0">
      <div class="max-w-4xl mx-auto py-3 sm:py-6 lg:py-8 px-3 sm:px-6">
        <!-- Hero Banner -->
        <div class="relative overflow-hidden rounded-xl mb-8 select-none h-48 sm:h-64 lg:h-80">
          <!-- Layer 1: 对角渐变背景 -->
          <div
            class="absolute inset-0"
            :style="{ background: getCoverColors(getTitleHash(catalogTitle)).gradient }"
          />
          <!-- Layer 2: 斜纹纹理 -->
          <div class="absolute inset-0 cover-pattern" />
          <!-- Layer 3: 暗角效果 -->
          <div class="absolute inset-0 cover-vignette" />
          <!-- 顶部装饰条 -->
          <div
            class="absolute top-0 left-0 right-0 h-5px"
            :style="{ background: getCoverColors(getTitleHash(catalogTitle)).accent }"
          />
          <!-- 书脊装饰 -->
          <div
            class="absolute left-0 top-0 bottom-0 w-14px"
            :style="{ background: getCoverColors(getTitleHash(catalogTitle)).spine }"
          />
          <!-- 装饰边框 -->
          <div
            class="absolute top-16px left-22px right-16px bottom-16px rounded-sm border border-white/10"
          />
          <div
            class="absolute top-18px left-24px right-18px bottom-18px rounded-sm border border-white/6"
          />

          <!-- Hero 内容 -->
          <div class="absolute inset-0 left-14px flex items-center px-10">
            <div class="flex-1 flex flex-col justify-center py-8">
              <span class="text-white/35 text-xs font-medium tracking-0.2em uppercase mb-4">
                操作手册
              </span>
              <h1
                class="text-white font-bold text-3xl leading-tight mb-3"
                style="text-shadow: 0 2px 8px rgba(0, 0, 0, 0.25)"
              >
                {{ catalogTitle }}
              </h1>
              <p v-if="coverInfo?.subtitle" class="text-white/65 text-base max-w-xl">
                {{ coverInfo.subtitle }}
              </p>
              <div class="flex items-center gap-4 mt-5 text-white/35 text-xs">
                <span>{{ new Date().toISOString().slice(0, 10) }}</span>
                <span v-if="latestPublishedVersion">{{ latestPublishedVersion }}</span>
                <span>{{ totalChapters }} 章</span>
              </div>
            </div>
            <!-- 右侧装饰图标 -->
            <div class="flex-shrink-0 ml-8">
              <span class="i-lucide-book-open w-20 h-20 text-white/12" />
            </div>
          </div>

          <!-- 底部渐变淡出 -->
          <div
            class="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"
          />
        </div>

        <!-- 变更记录 -->
        <div v-if="changelog.length > 0" class="bg-surface rounded-xl shadow-sm p-8 mb-6">
          <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
            <span class="i-lucide-history w-4 h-4 color-accent" />
            变更记录
          </h2>
          <div class="space-y-1 text-sm">
            <div
              v-for="v in changelog"
              :key="v.id"
              class="flex items-center gap-2 py-1 cursor-pointer hover:color-accent"
              :class="v.id === selectedVersionId ? 'color-accent' : 'text-secondary'"
              @click="() => onSelectVersion(v.id)"
            >
              <span class="font-mono text-muted flex-shrink-0"
                >v{{ v.versionMajor }}.{{ v.versionMinor }}</span
              >
              <span class="text-muted flex-shrink-0">{{ v.createdAt.slice(0, 10) }}</span>
              <span>{{ v.changeNotes || '（无变更说明）' }}</span>
              <span
                v-if="v.publishScope === 'all'"
                class="text-xs px-1 py-0 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 flex-shrink-0"
                title="此版本发布时包含了未审核内容"
                >含未审核</span
              >
            </div>
          </div>
        </div>

        <!-- 目录 -->
        <div class="bg-surface rounded-xl shadow-sm p-8">
          <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
            <span class="i-lucide-list-tree w-4 h-4 color-accent" />
            目录
          </h2>
          <div class="text-sm">
            <template v-for="node in tree" :key="isCoverPart(node) ? node.id : node.featureId">
              <template v-if="isCoverPart(node)">
                <div class="font-semibold text-secondary mt-3 mb-1">
                  {{ (node as SidebarPart).title }}
                </div>
                <div v-for="ch in (node as SidebarPart).children" :key="ch.featureId" class="pl-4">
                  <div
                    class="py-0.5 cursor-pointer hover:color-accent text-secondary"
                    @click="() => emit('navigate', { chNum: ch.chNum })"
                  >
                    <span class="font-mono text-muted mr-2">{{ ch.chNum }}</span>
                    <span>{{ ch.title }}</span>
                  </div>
                  <template v-if="!ch.isLeaf">
                    <div
                      v-for="(sec, i) in ch.sections"
                      :key="sec.key"
                      class="pl-8 py-0.5 cursor-pointer hover:color-accent text-secondary text-xs"
                      @click="() => emit('navigate', { chNum: ch.chNum, anchorId: sec.anchorId })"
                    >
                      {{ ch.chNum }}.{{ i + 1 }} {{ sec.title }}
                    </div>
                  </template>
                </div>
              </template>
              <div v-else class="pl-4">
                <div
                  class="py-0.5 cursor-pointer hover:color-accent text-secondary"
                  @click="() => emit('navigate', { chNum: (node as SidebarChapter).chNum })"
                >
                  <span class="font-mono text-muted mr-2">{{
                    (node as SidebarChapter).chNum
                  }}</span>
                  <span>{{ (node as SidebarChapter).title }}</span>
                </div>
                <template v-if="!(node as SidebarChapter).isLeaf">
                  <div
                    v-for="(sec, i) in (node as SidebarChapter).sections"
                    :key="sec.key"
                    class="pl-8 py-0.5 cursor-pointer hover:color-accent text-secondary text-xs"
                    @click="
                      () =>
                        emit('navigate', {
                          chNum: (node as SidebarChapter).chNum,
                          anchorId: sec.anchorId,
                        })
                    "
                  >
                    {{ (node as SidebarChapter).chNum }}.{{ i + 1 }} {{ sec.title }}
                  </div>
                </template>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- Loading -->
    <div v-else-if="loading" class="max-w-3xl mx-auto py-3 sm:py-6 lg:py-8 px-3 sm:px-6">
      <div class="bg-surface rounded-xl shadow-sm p-8 flex items-center justify-center">
        <span
          class="i-lucide-loader-2 w-5 h-5 inline-block align-middle animate-spin text-blue-400 mr-2"
        />
        <span class="text-sm text-muted">加载章...</span>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="max-w-3xl mx-auto py-3 sm:py-6 lg:py-8 px-3 sm:px-6">
      <div class="bg-surface rounded-xl shadow-sm p-8 text-center text-red-400 text-sm">
        {{ error }}
      </div>
    </div>

    <!-- 章节内容 -->
    <template v-else-if="chapter">
      <div class="flex max-w-5xl mx-auto">
        <div class="flex-1 min-w-0 py-3 sm:py-6 lg:py-8 px-3 sm:px-6 max-w-3xl">
          <div class="bg-surface rounded-xl shadow-sm p-8">
            <!-- eslint-disable vue/no-v-html -- 手册 Markdown 渲染，核心功能 -->
            <div
              class="manual-content"
              @click="onContentClick"
              v-html="renderHtml(chapter.markdown)"
            />
            <!-- eslint-enable vue/no-v-html -->
          </div>

          <!-- 上一章 / 下一章 导航 -->
          <div v-if="totalChapters > 1" class="flex items-center justify-between mt-6">
            <button
              class="btn-secondary text-sm flex items-center gap-1"
              :disabled="chNum! <= 1"
              :class="{ 'opacity-40 cursor-not-allowed': chNum! <= 1 }"
              @click="() => emit('navigate', { chNum: chNum! - 1 })"
            >
              <span class="i-lucide-chevron-left w-4 h-4 inline-block align-middle" />
              上一章
            </button>
            <span class="text-xs text-muted">{{ chNum }} / {{ totalChapters }}</span>
            <button
              class="btn-secondary text-sm flex items-center gap-1"
              :disabled="chNum! >= totalChapters"
              :class="{ 'opacity-40 cursor-not-allowed': chNum! >= totalChapters }"
              @click="() => emit('navigate', { chNum: chNum! + 1 })"
            >
              下一章
              <span class="i-lucide-chevron-right w-4 h-4 inline-block align-middle" />
            </button>
          </div>
        </div>

        <!-- 右侧页内目录 -->
        <aside v-if="tocItems.length > 0" class="hidden xl:block w-48 flex-shrink-0 py-8 pr-4">
          <nav class="sticky top-20">
            <div class="text-xs font-semibold text-muted uppercase mb-3 tracking-wider">
              本页目录
            </div>
            <ul class="space-y-0">
              <li v-for="item in tocItems" :key="item.id">
                <button
                  class="block w-full text-left text-xs py-1.5 border-l-2 transition-colors truncate"
                  :class="[
                    item.level === 2 ? 'pl-3' : 'pl-5',
                    activeTocId === item.id
                      ? 'color-accent border-blue-500 bg-active'
                      : 'text-secondary border-transparent hover:text-secondary hover:border-input',
                  ]"
                  :title="item.text"
                  @click="() => scrollToHeading(item.id)"
                >
                  {{ item.text }}
                </button>
              </li>
            </ul>
          </nav>
        </aside>
      </div>
    </template>

    <!-- No chapter selected -->
    <div v-else class="max-w-3xl mx-auto py-3 sm:py-6 lg:py-8 px-3 sm:px-6">
      <div class="bg-surface rounded-xl shadow-sm p-8 text-center text-muted text-sm">
        请从左侧目录选择章
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 书封斜纹纹理 */
.cover-pattern {
  background-image: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 3px,
    rgba(255, 255, 255, 0.03) 3px,
    rgba(255, 255, 255, 0.03) 6px
  );
  pointer-events: none;
}

/* 书封暗角效果 */
.cover-vignette {
  background: radial-gradient(ellipse at 40% 45%, transparent 55%, rgba(0, 0, 0, 0.15) 100%);
  pointer-events: none;
}

.manual-content :deep(*) {
  overflow-wrap: break-word;
  word-break: break-all;
}
.manual-content :deep(h1) {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 1.5em 0 0.5em;
}
.manual-content :deep(h2) {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 1.25em 0 0.5em;
  border-bottom: 1px solid var(--c-border);
  padding-bottom: 0.25em;
}
.manual-content :deep(h3) {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 1em 0 0.5em;
}
.manual-content :deep(h4) {
  font-size: 1rem;
  font-weight: 600;
  margin: 0.75em 0 0.5em;
}
.manual-content :deep(p) {
  margin: 0.5em 0;
  line-height: 1.8;
}
.manual-content :deep(blockquote) {
  border-left: 3px solid var(--c-border-input);
  padding-left: 1em;
  color: var(--c-text-muted);
  margin: 0.5em 0;
}
.manual-content :deep(code) {
  background: var(--c-bg-hover);
  padding: 0.15em 0.3em;
  border-radius: 0.25em;
  font-size: 0.875em;
}
.manual-content :deep(pre) {
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.manual-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--c-border);
  margin: 1.5em 0;
}
.manual-content :deep(strong) {
  font-weight: 600;
}
.manual-content :deep(em) {
  font-style: italic;
}
.manual-content :deep(a) {
  color: var(--c-accent);
  text-decoration: none;
}
.manual-content :deep(a:hover) {
  text-decoration: underline;
}
.manual-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
  table-layout: fixed;
}
.manual-content :deep(th) {
  background: var(--c-bg-hover);
  font-weight: 600;
  border: 1px solid var(--c-border-input);
  padding: 0.5em 0.75em;
  text-align: left;
}
.manual-content :deep(td) {
  border: 1px solid var(--c-border-input);
  padding: 0.5em 0.75em;
  overflow-wrap: break-word;
}
.manual-content :deep(.crossref-link) {
  color: var(--c-accent);
  background: var(--c-accent-bg);
  padding: 0.1em 0.4em;
  border-radius: 0.25em;
  font-size: 0.9em;
  text-decoration: none;
  white-space: nowrap;
}
.manual-content :deep(.crossref-link:hover) {
  text-decoration: underline;
  background: var(--c-accent-bg);
}

.manual-content :deep(img) {
  max-width: 100%;
  border-radius: 0.5em;
  background: var(--c-bg-hover);
}
</style>
