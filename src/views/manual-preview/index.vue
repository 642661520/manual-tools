<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProject } from '@/composables/useProject'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import { useSidebarTree } from '@/composables/useSidebarTree'
import { useResponsiveSidebar } from '@/composables/useResponsiveSidebar'
import {
  getPreview,
  getVersions,
  getVersionPreview,
  publishCatalog,
  updateVersionVisibility,
  getMarkdownExportUrl,
  getPdfExportUrl,
  getVersionPdfExportUrl,
  getSiteExportUrl,
} from '@/api/endpoints/catalogs'
import { api } from '@/api/client'
import type { CatalogVersionInfo, CatalogEntry } from '@shared/types'
import SelectDropdown from '@/components/SelectDropdown.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import Paginator from '@/components/Paginator.vue'
import PreviewSidebar from './PreviewSidebar.vue'
import PreviewContent from './PreviewContent.vue'
import VersionDiff from '@/components/VersionDiff.vue'
import LoadingState from '@/components/LoadingState.vue'

const route = useRoute()
const router = useRouter()
const { currentProjectId } = useProject()
const { canManageProject } = useAuth()
const { alert } = useDialog()

// ====== 手册 ID（从路由获取） ======
const selectedCatalogId = ref<string | null>(null)

function initCatalogId() {
  const fromParam = route.params.id as string | undefined
  const fromQuery = route.query.catalog as string | undefined
  const id = fromParam || fromQuery || null
  if (id && id !== selectedCatalogId.value) {
    selectedCatalogId.value = id
    selectedVersionId.value = null
  }
}

// ====== 版本列表 ======
const versions = ref<CatalogVersionInfo[]>([])
const selectedVersionId = ref<string | null>(null)

async function loadVersions() {
  if (!selectedCatalogId.value) {
    versions.value = []
    selectedVersionId.value = null
    return
  }
  try {
    const data = await getVersions(selectedCatalogId.value)
    versions.value = data
    const fromUrl = route.query.version as string | undefined
    selectedVersionId.value =
      fromUrl && versions.value.some((v: CatalogVersionInfo) => v.id === fromUrl) ? fromUrl : null
  } catch {
    /* ignore */
  }
}

function selectVersion(id: string | number | null) {
  selectedVersionId.value = id ? (id as string) : null
  const query: Record<string, string> = { catalog: selectedCatalogId.value! }
  if (id) query.version = id as string
  router.replace({ query })
}

// ====== 预览数据 ======
const catalogTitle = ref('')
const loading = ref(true)
const previewMode = ref<'all' | 'approved'>('all')
const notFound = ref(false)

interface FeatureMeta {
  id: string
  title: string
  description: string
  sections: Array<{ key: string; title: string; description?: string }>
}

const previewData = ref<{
  title: string
  features: FeatureMeta[]
  entries: CatalogEntry[]
  publishScope?: string
  statusSnapshot?: Record<string, string>
}>({
  title: '',
  features: [],
  entries: [],
})

// 封面信息（从 API 响应中提取）
const coverInfo = ref<Record<string, unknown>>({})

// 侧边栏树
const { tree, chapterMap, hasParts, totalChapters } = useSidebarTree(
  computed(() => previewData.value.entries),
  computed(() => previewData.value.features),
)

// 当前章
const activeChapter = ref<number | null>(null)

// 从 URL hash 恢复章
function syncChapterFromHash() {
  const hash = window.location.hash.slice(1)
  if (hash === 'cover') {
    activeChapter.value = 0
    return
  }
  const match = hash.match(/^ch(\d+)/)
  if (match) {
    const ch = parseInt(match[1])
    if (ch >= 1 && ch <= totalChapters.value) {
      activeChapter.value = ch
      return
    }
  }
  activeChapter.value = 0 // 默认概览
}

// 章切换
function navigateToChapter(chNum: number, anchorId?: string) {
  if (chNum < 0 || chNum > totalChapters.value) return
  activeChapter.value = chNum
  if (chNum === 0) {
    router.replace({ hash: '#cover' })
  } else {
    router.replace({ hash: '#ch' + chNum })
  }
  if (anchorId) {
    nextTick(() => {
      setTimeout(() => {
        const el = document.getElementById(anchorId)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 150)
    })
  }
}

/** 移动端：导航并关闭侧边栏 */
function navigateAndClose(chNum: number) {
  navigateToChapter(chNum)
  closeSidebar()
}

async function loadPreview() {
  if (!selectedCatalogId.value) {
    previewData.value = { title: '', features: [], entries: [] }
    loading.value = false
    return
  }
  loading.value = true
  notFound.value = false
  try {
    if (selectedVersionId.value) {
      const data = await getVersionPreview(
        selectedCatalogId.value,
        selectedVersionId.value,
        previewMode.value,
      )
      catalogTitle.value = data.title
      previewData.value = {
        title: data.title,
        features: data.features || [],
        entries: data.entries || [],
        publishScope: data.publishScope,
        statusSnapshot: data.statusSnapshot,
      }
      coverInfo.value = {}
    } else {
      const data = await getPreview(selectedCatalogId.value, previewMode.value)
      catalogTitle.value = data.catalog.title
      previewData.value = {
        title: data.catalog.title,
        features: data.features,
        entries: data.catalog.entries || [],
      }
      coverInfo.value = data.catalog.coverInfo || {}
    }
    syncChapterFromHash()
  } catch {
    notFound.value = true
    previewData.value = { title: '', features: [], entries: [] }
  } finally {
    loading.value = false
  }
}

// ====== 操作 ======
const exportingMd = ref(false)
const exportingPdf = ref(false)
const exportingSite = ref(false)
const publishing = ref(false)
const publishDialogVisible = ref(false)
const publishChangeNotes = ref('')
const publishVisibility = ref('project_members')
const publishError = ref('')

const visibilityOptions = [
  { value: 'project_members', label: '仅项目成员' },
  { value: 'login_required', label: '登录即可查看' },
  { value: 'public', label: '公开（无需登录）' },
]

const visibilityLabels: Record<string, string> = {
  public: '公开',
  login_required: '登录可见',
  project_members: '项目成员',
}

function openPublishDialog() {
  publishChangeNotes.value = ''
  publishVisibility.value = 'project_members'
  publishApprovedOnly.value = true
  publishError.value = ''
  loadReviewStats()
  publishDialogVisible.value = true
}

const publishApprovedOnly = ref(true)
const diffVisible = ref(false)
const {
  sidebarOpen: showSidebar,
  toggleSidebar: toggleSidebar,
  closeSidebar: closeSidebar,
} = useResponsiveSidebar()
const reviewStats = ref<{ approved: number; total: number } | null>(null)

async function loadReviewStats() {
  if (!selectedCatalogId.value) return
  try {
    const data = await getPreview(selectedCatalogId.value, 'approved')
    // 取 approval stats
    const allData = await getPreview(selectedCatalogId.value)
    const approvedSet = new Set(
      data.features.flatMap((f) => f.sections.map((s) => `${f.id}/${s.key}`)),
    )
    const allSet = new Set(
      allData.features.flatMap((f) => f.sections.map((s) => `${f.id}/${s.key}`)),
    )
    reviewStats.value = { approved: approvedSet.size, total: allSet.size }
  } catch {
    reviewStats.value = null
  }
}

async function doPublish() {
  if (!publishChangeNotes.value.trim()) {
    publishError.value = '请输入变更说明'
    return
  }
  publishing.value = true
  publishError.value = ''
  try {
    const data = await publishCatalog(
      selectedCatalogId.value!,
      publishChangeNotes.value.trim(),
      publishVisibility.value,
      publishApprovedOnly.value,
    )
    publishDialogVisible.value = false
    await loadVersions()
    const approvedMsg = data.total > 0 ? `（${data.approved}/${data.total} 已审核）` : ''
    await alert(`版本 v${data.versionMajor}.${data.versionMinor} 已发布 ${approvedMsg}`)
  } catch (e: unknown) {
    publishError.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    publishing.value = false
  }
}

async function updateVisibility(versionId: string, visibility: string) {
  try {
    await updateVersionVisibility(selectedCatalogId.value!, versionId, visibility)
    await loadVersions()
  } catch (e: unknown) {
    await alert('切换失败: ' + (e instanceof Error ? e.message : '网络错误'))
  }
}

async function exportMarkdown() {
  if (!selectedCatalogId.value) return
  exportingMd.value = true
  try {
    const url = getMarkdownExportUrl(selectedCatalogId.value)
    await api.download(url)
  } catch (e: unknown) {
    await alert('导出失败: ' + (e instanceof Error ? e.message : '网络错误'))
  } finally {
    exportingMd.value = false
  }
}

async function exportPdf() {
  if (!selectedCatalogId.value) return
  exportingPdf.value = true
  try {
    let url: string
    const mode = previewMode.value === 'approved' ? 'approved' : undefined
    if (selectedVersionId.value) {
      url = getVersionPdfExportUrl(selectedCatalogId.value, selectedVersionId.value, mode)
    } else {
      url = getPdfExportUrl(selectedCatalogId.value, mode)
    }
    await api.download(url)
  } catch (e: unknown) {
    await alert('导出失败: ' + (e instanceof Error ? e.message : '网络错误'))
  } finally {
    exportingPdf.value = false
  }
}

async function exportSite() {
  if (!selectedCatalogId.value) return
  exportingSite.value = true
  try {
    const url = getSiteExportUrl(selectedCatalogId.value)
    await api.download(url)
  } catch (e: unknown) {
    await alert('导出失败: ' + (e instanceof Error ? e.message : '网络错误'))
  } finally {
    exportingSite.value = false
  }
}

// ====== 变更记录 ======
const changelogVersions = computed(() => {
  if (!selectedVersionId.value) return versions.value
  const t = versions.value.find((v: CatalogVersionInfo) => v.id === selectedVersionId.value)
  if (!t) return versions.value
  return versions.value.filter(
    (v: CatalogVersionInfo) =>
      v.versionMajor < t.versionMajor ||
      (v.versionMajor === t.versionMajor && v.versionMinor <= t.versionMinor),
  )
})

const currentVersionVis = computed(() => {
  const v = versions.value.find((v: CatalogVersionInfo) => v.id === selectedVersionId.value)
  return v?.visibility || 'project_members'
})

const currentVersionPublishScope = computed(() => {
  const v = versions.value.find((v: CatalogVersionInfo) => v.id === selectedVersionId.value)
  return v?.publishScope || 'all'
})

const docUrl = computed(() => {
  if (!selectedCatalogId.value) return ''
  const v = versions.value.find((v: CatalogVersionInfo) => v.id === selectedVersionId.value)
  if (!v) return `/docs/${selectedCatalogId.value}/latest/`
  return `/docs/${selectedCatalogId.value}/v${v.versionMajor}.${v.versionMinor}/`
})

// ====== 生命周期 ======
async function reloadAll() {
  initCatalogId()
  await loadVersions()
  await loadPreview()
}

function onHashChange() {
  syncChapterFromHash()
}

onMounted(() => {
  reloadAll()
  window.addEventListener('hashchange', onHashChange)
})

watch(currentProjectId, () => {
  reloadAll()
})
watch(selectedCatalogId, () => {
  loadVersions().then(loadPreview)
})
watch([selectedVersionId, previewMode], () => {
  loadPreview()
})
watch(catalogTitle, (t) => {
  if (t) document.title = t
})
onUnmounted(() => {
  document.title = '操作手册编写平台'
  window.removeEventListener('hashchange', onHashChange)
})
</script>

<template>
  <div class="h-full flex flex-col bg-gray-100">
    <!-- 顶部操作栏 -->
    <header
      class="flex-shrink-0 bg-white border-b border-gray-200 px-2 sm:px-4 lg:px-6 py-1.5 sm:py-2 z-10"
    >
      <div class="flex items-center gap-1 sm:gap-2">
        <!-- 返回按钮 -->
        <button
          class="h-8 sm:h-auto w-8 sm:w-auto flex items-center justify-center sm:px-3 sm:py-2 rounded hover:bg-gray-100 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors text-sm"
          @click="router.push('/manuals')"
        >
          <span class="i-lucide-arrow-left w-4 h-4 inline-block align-middle sm:mr-1" />
          <span class="hidden sm:inline">返回手册</span>
        </button>

        <!-- 移动端目录按钮 -->
        <button
          class="md:hidden h-8 w-8 flex items-center justify-center rounded hover:bg-gray-100 flex-shrink-0 text-gray-500"
          v-tooltip="'目录'"
          @click="toggleSidebar"
        >
          <span class="i-lucide-list-tree w-4 h-4 inline-block align-middle" />
        </button>

        <!-- 标题 / 离线站点 -->
        <template v-if="selectedCatalogId">
          <button
            class="h-8 sm:h-auto text-xs sm:text-sm text-gray-500 hover:text-blue-600 border border-dashed border-gray-300 hover:border-blue-400 rounded-lg px-2 sm:px-3 py-0 sm:py-2 bg-white transition-colors flex items-center gap-1 flex-shrink-0"
            :disabled="exportingSite"
            v-tooltip="'下载所有公开版本的静态站点 ZIP'"
            @click="exportSite"
          >
            <span
              v-if="exportingSite"
              class="i-lucide-loader-2 w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block align-middle animate-spin"
            />
            <span
              v-else
              class="i-lucide-download w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block align-middle sm:mr-0.5"
            />
            <span class="hidden sm:inline">离线站点</span>
          </button>
        </template>
        <h1
          v-else
          class="text-sm sm:text-lg font-semibold text-gray-800 truncate max-w-[160px] sm:max-w-xs"
        >
          {{ catalogTitle || '手册预览' }}
        </h1>

        <!-- 分隔 -->
        <div class="w-px h-5 sm:h-6 bg-gray-200 hidden sm:block flex-shrink-0" />

        <!-- 操作区：移动端横向滚动 -->
        <div
          class="flex items-center gap-1 sm:gap-2 flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-visible scrollbar-none min-w-0"
        >
          <!-- 版本选择 -->
          <div v-if="selectedCatalogId && versions.length > 0" class="flex-shrink-0">
            <SelectDropdown
              btn-class="px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm"
              width-class="w-32 sm:w-44 lg:w-52"
              placeholder="最新版本"
              :model-value="selectedVersionId || ''"
              :options="[
                { value: '', label: '当前最新' },
                ...versions.map((v) => {
                  const vis = visibilityLabels[v.visibility] || '项目成员'
                  return { value: v.id, label: `v${v.versionMajor}.${v.versionMinor} · ${vis}` }
                }),
              ]"
              @update:model-value="selectVersion"
            />
          </div>
          <!-- 预览模式：仅实时内容可用 -->
          <SelectDropdown
            v-if="selectedCatalogId && !selectedVersionId"
            btn-class="px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm"
            width-class="w-22 sm:w-28"
            placeholder="全部"
            :model-value="previewMode"
            :options="[
              { value: 'all', label: '全部内容' },
              { value: 'approved', label: '仅已审核' },
            ]"
            class="flex-shrink-0"
            @update:model-value="
              (val: string | number | null) => (previewMode = (val as 'all' | 'approved') || 'all')
            "
          />

          <!-- PM：实时内容 -->
          <template v-if="canManageProject && selectedCatalogId && !selectedVersionId">
            <div class="w-px h-4 sm:h-5 bg-gray-300 hidden sm:block flex-shrink-0" />
            <a
              :href="docUrl"
              target="_blank"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              >在线文档</a
            >
            <button
              class="h-8 sm:h-auto btn-primary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="publishing"
              @click="openPublishDialog"
            >
              <span
                v-if="publishing"
                class="i-lucide-loader-2 w-3 h-3 sm:w-4 sm:h-4 inline-block align-middle animate-spin mr-0.5"
              />发布版本
            </button>
            <button
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingMd"
              @click="exportMarkdown"
              v-tooltip="'下载 Markdown'"
            >
              <span
                v-if="exportingMd"
                class="i-lucide-loader-2 w-3 h-3 sm:w-4 sm:h-4 inline-block align-middle animate-spin mr-0.5"
              />
              <span
                v-else
                class="i-lucide-file-code w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block align-middle mr-0.5"
              />
              <span class="hidden sm:inline">下载 MD</span>
            </button>
            <button
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingPdf"
              @click="exportPdf"
              v-tooltip="'下载 PDF'"
            >
              <span
                v-if="exportingPdf"
                class="i-lucide-loader-2 w-3 h-3 sm:w-4 sm:h-4 inline-block align-middle animate-spin mr-0.5"
              />
              <span
                v-else
                class="i-lucide-file-text w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block align-middle mr-0.5"
              />
              <span class="hidden sm:inline">下载 PDF</span>
            </button>
            <button
              v-if="versions.length >= 2"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              @click="diffVisible = true"
            >
              对比
            </button>
          </template>

          <!-- PM：历史版本 -->
          <template v-if="canManageProject && selectedCatalogId && selectedVersionId">
            <div class="w-px h-4 sm:h-5 bg-gray-300 hidden sm:block flex-shrink-0" />
            <SelectDropdown
              btn-class="px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm"
              width-class="w-24 sm:w-28"
              :model-value="currentVersionVis"
              :options="visibilityOptions"
              class="flex-shrink-0"
              @update:model-value="
                (val: string | number | null) => updateVisibility(selectedVersionId!, val as string)
              "
            />
            <span
              v-if="currentVersionPublishScope === 'all'"
              class="h-8 sm:h-auto inline-flex items-center text-xs sm:text-sm px-1.5 sm:px-2 rounded-full bg-yellow-100 text-yellow-700 flex-shrink-0"
              >含未审核</span
            >
            <a
              v-if="selectedVersionId"
              :href="docUrl"
              target="_blank"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              >在线文档</a
            >
            <button
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingMd"
              @click="exportMarkdown"
              v-tooltip="'下载 Markdown'"
            >
              <span
                v-if="exportingMd"
                class="i-lucide-loader-2 w-3 h-3 sm:w-4 sm:h-4 inline-block align-middle animate-spin mr-0.5"
              />
              <span
                v-else
                class="i-lucide-file-code w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block align-middle mr-0.5"
              />
              <span class="hidden sm:inline">下载 MD</span>
            </button>
            <button
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingPdf"
              @click="exportPdf"
              v-tooltip="'下载 PDF'"
            >
              <span
                v-if="exportingPdf"
                class="i-lucide-loader-2 w-3 h-3 sm:w-4 sm:h-4 inline-block align-middle animate-spin mr-0.5"
              />
              <span
                v-else
                class="i-lucide-file-text w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block align-middle mr-0.5"
              />
              <span class="hidden sm:inline">下载 PDF</span>
            </button>
          </template>

          <!-- 运维 -->
          <template v-if="!canManageProject && selectedCatalogId">
            <div class="w-px h-4 sm:h-5 bg-gray-300 hidden sm:block flex-shrink-0" />
            <span
              v-if="selectedVersionId"
              class="h-8 sm:h-auto inline-flex items-center text-xs sm:text-sm px-1.5 sm:px-2 rounded-full flex-shrink-0"
              :class="
                currentVersionVis === 'public'
                  ? 'bg-green-100 text-green-700'
                  : currentVersionVis === 'login_required'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600'
              "
              >{{ visibilityLabels[currentVersionVis] || '项目成员' }}</span
            >
            <span
              v-if="selectedVersionId && currentVersionPublishScope === 'all'"
              class="h-8 sm:h-auto inline-flex items-center text-xs sm:text-sm px-1.5 sm:px-2 rounded-full bg-yellow-100 text-yellow-700 flex-shrink-0"
              >含未审核</span
            >
            <a
              :href="docUrl"
              target="_blank"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              >在线文档</a
            >
            <button
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingMd"
              @click="exportMarkdown"
              v-tooltip="'下载 Markdown'"
            >
              <span
                v-if="exportingMd"
                class="i-lucide-loader-2 w-3 h-3 sm:w-4 sm:h-4 inline-block align-middle animate-spin mr-0.5"
              />
              <span
                v-else
                class="i-lucide-file-code w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block align-middle mr-0.5"
              />
              <span class="hidden sm:inline">下载 MD</span>
            </button>
            <button
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingPdf"
              @click="exportPdf"
              v-tooltip="'下载 PDF'"
            >
              <span
                v-if="exportingPdf"
                class="i-lucide-loader-2 w-3 h-3 sm:w-4 sm:h-4 inline-block align-middle animate-spin mr-0.5"
              />
              <span
                v-else
                class="i-lucide-file-text w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block align-middle mr-0.5"
              />
              <span class="hidden sm:inline">下载 PDF</span>
            </button>
          </template>
        </div>
      </div>
    </header>

    <LoadingState v-if="loading" />

    <!-- 无项目 -->
    <div v-else-if="!currentProjectId" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <span class="i-lucide-folder-open text-4xl text-gray-300 mb-3 block mx-auto" />
        <p class="text-gray-500 text-sm">请先加入项目</p>
        <p class="text-gray-400 text-xs mt-1">联系管理员将您添加到项目成员中</p>
      </div>
    </div>

    <!-- 无手册选中 -->
    <div v-else-if="!selectedCatalogId" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <span class="i-lucide-book-open text-4xl text-gray-300 mb-3 block mx-auto" />
        <p class="text-gray-500 text-sm">未选择手册</p>
        <router-link to="/manuals" class="btn-primary text-sm mt-3 inline-block"
          >浏览手册</router-link
        >
      </div>
    </div>

    <!-- 手册内容：左右布局 -->
    <div
      v-else-if="previewData.entries.length > 0 || previewData.features.length > 0"
      class="flex-1 flex overflow-hidden"
    >
      <!-- 桌面端：固定侧边栏 -->
      <div class="hidden md:block flex-shrink-0">
        <PreviewSidebar
          :tree="tree"
          :active-chapter="activeChapter"
          :has-parts="hasParts"
          @select-chapter="navigateToChapter"
          @select-section="navigateToChapter"
          @select-cover="navigateToChapter(0)"
        />
      </div>

      <!-- 移动端：侧边栏抽屉 -->
      <Teleport to="body">
        <Transition name="slide-left">
          <div v-if="showSidebar" class="fixed inset-0 z-40 md:hidden">
            <div class="absolute inset-0 bg-black/30" @click="closeSidebar" />
            <div
              class="absolute left-0 top-0 bottom-0 w-64 max-w-[85vw] bg-white shadow-xl flex flex-col"
            >
              <div
                class="md:hidden flex items-center justify-between px-4 py-3 border-b border-gray-200"
              >
                <span class="text-sm font-semibold text-gray-700">目录</span>
                <button
                  class="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
                  @click="closeSidebar"
                >
                  <span class="i-lucide-x w-5 h-5 text-gray-500" />
                </button>
              </div>
              <PreviewSidebar
                :tree="tree"
                :active-chapter="activeChapter"
                :has-parts="hasParts"
                @select-chapter="navigateAndClose"
                @select-section="navigateAndClose"
                @select-cover="navigateAndClose(0)"
              />
            </div>
          </div>
        </Transition>
      </Teleport>
      <PreviewContent
        v-if="activeChapter !== null"
        :catalog-id="selectedCatalogId"
        :version-id="selectedVersionId"
        :preview-mode="previewMode"
        :ch-num="activeChapter"
        :total-chapters="totalChapters"
        :catalog-title="catalogTitle"
        :cover-info="coverInfo"
        :tree="tree"
        :has-parts="hasParts"
        :changelog="changelogVersions"
        :selected-version-id="selectedVersionId"
        :on-select-version="selectVersion"
        @navigate="navigateToChapter"
      />
      <div v-else class="flex-1 flex items-center justify-center text-gray-400 text-sm">
        无法定位章
      </div>
    </div>

    <!-- 发布版本弹窗 -->
    <ModalDialog
      :visible="publishDialogVisible"
      title="发布版本"
      confirm-text="发布"
      cancel-text="取消"
      :error="publishError"
      :loading="publishing"
      @close="publishDialogVisible = false"
      @confirm="doPublish"
    >
      <div class="space-y-4">
        <div>
          <label class="text-xs text-gray-500 mb-1 block">变更说明</label>
          <input
            v-model="publishChangeNotes"
            class="input text-sm"
            placeholder="本次发布的内容..."
            @keyup.enter="doPublish"
          />
        </div>
        <div>
          <label class="text-xs text-gray-500 mb-1 block">文档可见性</label>
          <div class="flex gap-2">
            <button
              v-for="opt in visibilityOptions"
              :key="opt.value"
              class="px-3 py-1.5 rounded border text-xs transition-colors"
              :class="
                publishVisibility === opt.value
                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                  : 'border-gray-300 hover:bg-gray-100'
              "
              @click="publishVisibility = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <!-- 审核状态 -->
        <div v-if="reviewStats" class="flex items-center justify-between text-xs">
          <span>
            审核状态：
            <span
              class="font-medium"
              :class="
                reviewStats.approved === reviewStats.total ? 'text-green-600' : 'text-yellow-600'
              "
            >
              {{ reviewStats.approved }} / {{ reviewStats.total }}
            </span>
            章已通过
          </span>
        </div>
        <label class="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" v-model="publishApprovedOnly" class="rounded" />
          <span>仅发布已审核内容（未审核的章将不包含在文档中）</span>
        </label>
      </div>
    </ModalDialog>
  </div>

  <VersionDiff
    :visible="diffVisible"
    :catalog-id="selectedCatalogId || ''"
    :versions="versions"
    @close="diffVisible = false"
  />
</template>

<style scoped>
/* 侧边栏抽屉过渡 */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: all 0.25s ease;
}
.slide-left-enter-from,
.slide-left-leave-to {
  opacity: 0;
}
.slide-left-enter-from > div:last-child,
.slide-left-leave-to > div:last-child {
  transform: translateX(-100%);
}

@media print {
  header {
    display: none !important;
  }
}
</style>
