<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProject } from '@/composables/useProject'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import { showErrorToast, showSuccessToast } from '@/composables/toast'
import { useSidebarTree } from '@/composables/useSidebarTree'
import { useResponsiveSidebar } from '@/composables/useResponsiveSidebar'
import {
  getPreview,
  getVersions,
  getVersionPreview,
  publishCatalog,
  updateVersionVisibility,
  updateVersionStatus,
  deleteVersion,
  getMarkdownExportUrl,
  getPdfExportUrl,
  getVersionPdfExportUrl,
} from '@/api/endpoints/catalogs'
import { api } from '@/api/client'
import type { CatalogVersionInfo, CatalogEntry } from '@shared/types'
import SelectDropdown from '@/components/SelectDropdown.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import PreviewSidebar from './PreviewSidebar.vue'
import PreviewContent from './PreviewContent.vue'
import VersionDiff from '@/components/VersionDiff.vue'
import LoadingState from '@/components/LoadingState.vue'
import CheckboxField from '@/components/CheckboxField.vue'

const route = useRoute()
const router = useRouter()
const { currentProjectId } = useProject()
const { isProjectPM } = useAuth()
const { alert, dangerConfirm } = useDialog()

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
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '加载版本列表失败')
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
const { tree, hasParts, totalChapters } = useSidebarTree(
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
      // 历史版本使用其自身发布时的状态快照
      const ver = versions.value.find((v: CatalogVersionInfo) => v.id === selectedVersionId.value)
      const mode = ver?.publishScope === 'approved' ? 'approved' : 'all'
      const data = await getVersionPreview(selectedCatalogId.value, selectedVersionId.value, mode)
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
    // 未编排内容：弹窗提示并返回手册列表
    if (previewData.value.entries.length === 0 && previewData.value.features.length === 0) {
      loading.value = false
      await alert('此手册尚未编排内容，请先在"编排目录"中添加功能章节后再预览。')
      router.replace('/manuals')
      return
    }
    syncChapterFromHash()
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '加载手册预览失败')
    notFound.value = true
    previewData.value = { title: '', features: [], entries: [] }
  } finally {
    loading.value = false
  }
}

// ====== 操作 ======
const exportingMd = ref(false)
const exportingPdf = ref(false)
const showPdfProgress = ref(false)
const pdfProgressMessage = ref('')
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
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '加载审核统计失败')
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
    showSuccessToast(`版本 v${data.versionMajor}.${data.versionMinor} 已发布 ${approvedMsg}`)
  } catch (e: unknown) {
    publishError.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    publishing.value = false
  }
}

// ====== 版本设置弹窗 ======
const versionSettingsVisible = ref(false)
const settingsVisibility = ref('project_members')
const settingsStatus = ref('active')
const settingsError = ref('')
const settingsSaving = ref(false)
let settingsTargetVersionId = ''

function openVersionSettings(versionId: string) {
  const v = versions.value.find((x: CatalogVersionInfo) => x.id === versionId)
  if (!v) return
  settingsTargetVersionId = versionId
  settingsVisibility.value = v.visibility
  settingsStatus.value = v.status || 'active'
  settingsError.value = ''
  versionSettingsVisible.value = true
}

async function saveVersionSettings() {
  settingsError.value = ''
  settingsSaving.value = true
  try {
    const v = versions.value.find((x: CatalogVersionInfo) => x.id === settingsTargetVersionId)
    if (!v) return
    const tasks: Promise<unknown>[] = []
    if (settingsVisibility.value !== v.visibility) {
      tasks.push(
        updateVersionVisibility(
          selectedCatalogId.value!,
          settingsTargetVersionId,
          settingsVisibility.value,
        ),
      )
    }
    if (settingsStatus.value !== (v.status || 'active')) {
      tasks.push(
        updateVersionStatus(
          selectedCatalogId.value!,
          settingsTargetVersionId,
          settingsStatus.value,
        ),
      )
    }
    await Promise.all(tasks)
    versionSettingsVisible.value = false
    await loadVersions()
    showSuccessToast('版本设置已保存')
  } catch (e: unknown) {
    settingsError.value = e instanceof Error ? e.message : '网络错误'
  } finally {
    settingsSaving.value = false
  }
}

async function doDeleteFromSettings() {
  const v = versions.value.find((x: CatalogVersionInfo) => x.id === settingsTargetVersionId)
  const label = v ? `v${v.versionMajor}.${v.versionMinor}` : settingsTargetVersionId
  const confirmed = await dangerConfirm(
    `确认删除版本 ${label} 吗？此操作不可撤销，将同时删除数据库记录和静态站点文件。`,
  )
  if (!confirmed) return
  try {
    versionSettingsVisible.value = false
    await deleteVersion(selectedCatalogId.value!, settingsTargetVersionId)
    if (selectedVersionId.value === settingsTargetVersionId) {
      selectedVersionId.value = null
    }
    await loadVersions()
    showSuccessToast('版本已删除')
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '删除版本失败')
  }
}

async function exportMarkdown() {
  if (!selectedCatalogId.value) return
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
  showPdfProgress.value = true
  pdfProgressMessage.value = '正在生成 PDF...'
  try {
    let url: string
    const mode = previewMode.value === 'approved' ? 'approved' : undefined
    if (selectedVersionId.value) {
      // 历史版本 PDF 使用其自身发布时的状态快照
      const ver = versions.value.find((v: CatalogVersionInfo) => v.id === selectedVersionId.value)
      const vMode = ver?.publishScope === 'approved' ? 'approved' : undefined
      url = getVersionPdfExportUrl(selectedCatalogId.value, selectedVersionId.value, vMode)
    } else {
      url = getPdfExportUrl(selectedCatalogId.value, mode)
    }
    pdfProgressMessage.value = '正在下载 PDF...'
    await api.download(url)
  } catch (e: unknown) {
    await alert('导出失败: ' + (e instanceof Error ? e.message : '网络错误'))
  } finally {
    exportingPdf.value = false
    showPdfProgress.value = false
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

const statusLabels: Record<string, string> = {
  active: '有效',
  deprecated: '已废弃',
  archived: '已归档',
}

const statusOptions = [
  { value: 'active', label: '有效' },
  { value: 'deprecated', label: '废弃' },
  { value: 'archived', label: '归档' },
]

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
  <div class="h-full flex flex-col bg-base">
    <!-- 顶部操作栏 -->
    <header
      class="flex-shrink-0 bg-surface border-b border-default px-2 sm:px-4 lg:px-6 py-1.5 sm:py-2 z-10"
    >
      <div class="flex items-center gap-1 sm:gap-2">
        <!-- 返回按钮 -->
        <button
          class="h-8 sm:h-auto w-8 sm:w-auto flex items-center justify-center sm:px-3 sm:py-2 rounded hover:bg-hover flex-shrink-0 text-muted hover:text-secondary transition-colors text-sm"
          @click="() => router.push('/manuals')"
        >
          <span class="i-lucide-arrow-left w-4 h-4 inline-block align-middle sm:mr-1" />
          <span class="hidden sm:inline">返回手册</span>
        </button>

        <!-- 移动端目录按钮 -->
        <button
          v-tooltip="'目录'"
          class="md:hidden h-8 w-8 flex items-center justify-center rounded hover:bg-hover flex-shrink-0 text-secondary"
          @click="toggleSidebar"
        >
          <span class="i-lucide-list-tree w-4 h-4 inline-block align-middle" />
        </button>

        <h1
          v-if="!selectedCatalogId"
          class="text-sm sm:text-lg font-semibold text-primary truncate max-w-[160px] sm:max-w-xs"
        >
          {{ catalogTitle || '手册预览' }}
        </h1>

        <!-- 分隔 -->
        <div class="w-px h-5 sm:h-6 bg-[var(--c-border)] hidden sm:block flex-shrink-0" />

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
                  const st = v.status !== 'active' ? ` · ${statusLabels[v.status]}` : ''
                  const sc = v.publishScope === 'all' ? ' · 含未审核' : ''
                  return {
                    value: v.id,
                    label: `v${v.versionMajor}.${v.versionMinor} · ${vis}${st}${sc}`,
                  }
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
          <template v-if="isProjectPM && selectedCatalogId && !selectedVersionId">
            <div class="w-px h-4 sm:h-5 bg-[var(--c-border-input)] hidden sm:block flex-shrink-0" />
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
              v-tooltip="'下载 Markdown'"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingMd"
              @click="exportMarkdown"
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
              v-tooltip="'下载 PDF'"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingPdf"
              @click="exportPdf"
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
          <template v-if="isProjectPM && selectedCatalogId && selectedVersionId">
            <div class="w-px h-4 sm:h-5 bg-[var(--c-border-input)] hidden sm:block flex-shrink-0" />
            <button
              v-tooltip="'版本设置'"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              @click="() => openVersionSettings(selectedVersionId!)"
            >
              <span class="i-lucide-settings w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block align-middle" />
              <span class="hidden sm:inline ml-0.5">设置</span>
            </button>
            <div class="w-px h-4 sm:h-5 bg-[var(--c-border-input)] hidden sm:block flex-shrink-0" />
            <a
              v-if="selectedVersionId"
              :href="docUrl"
              target="_blank"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              >在线文档</a
            >
            <button
              v-tooltip="'下载 Markdown'"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingMd"
              @click="exportMarkdown"
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
              v-tooltip="'下载 PDF'"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingPdf"
              @click="exportPdf"
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
          <template v-if="!isProjectPM && selectedCatalogId">
            <div class="w-px h-4 sm:h-5 bg-[var(--c-border-input)] hidden sm:block flex-shrink-0" />
            <a
              :href="docUrl"
              target="_blank"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              >在线文档</a
            >
            <button
              v-tooltip="'下载 Markdown'"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingMd"
              @click="exportMarkdown"
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
              v-tooltip="'下载 PDF'"
              class="h-8 sm:h-auto btn-secondary text-xs sm:text-sm px-2 sm:px-3 py-0 sm:py-2 flex-shrink-0"
              :disabled="exportingPdf"
              @click="exportPdf"
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
        <span class="i-lucide-folder-open text-4xl text-muted mb-3 block mx-auto" />
        <p class="text-secondary text-sm">请先加入项目</p>
        <p class="text-muted text-xs mt-1">联系管理员将您添加到项目成员中</p>
      </div>
    </div>

    <!-- 无手册选中 -->
    <div v-else-if="!selectedCatalogId" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <span class="i-lucide-book-open text-4xl text-muted mb-3 block mx-auto" />
        <p class="text-secondary text-sm">未选择手册</p>
        <router-link to="/manuals" class="btn-primary text-sm mt-3 inline-block">
          浏览手册
        </router-link>
      </div>
    </div>

    <!-- 手册内容：左右布局 -->
    <div
      v-else-if="previewData.entries.length > 0 || previewData.features.length > 0"
      class="flex-1 flex overflow-hidden"
    >
      <!-- 桌面端：固定侧边栏 -->
      <div class="hidden md:block flex-shrink-0 h-full">
        <PreviewSidebar
          :tree="tree"
          :active-chapter="activeChapter"
          :has-parts="hasParts"
          @select-chapter="navigateToChapter"
          @select-section="(p) => navigateToChapter(p.chNum, p.anchorId)"
          @select-cover="() => navigateToChapter(0)"
        />
      </div>

      <!-- 移动端：侧边栏抽屉 -->
      <Teleport to="body">
        <Transition name="slide-left">
          <div v-if="showSidebar" class="fixed inset-0 z-40 md:hidden">
            <div class="absolute inset-0 bg-black/30" @click="closeSidebar" />
            <div
              class="absolute left-0 top-0 bottom-0 w-64 max-w-[85vw] bg-surface shadow-xl flex flex-col"
            >
              <div
                class="md:hidden flex items-center justify-between px-4 py-3 border-b border-default"
              >
                <span class="text-sm font-semibold text-secondary">目录</span>
                <button
                  class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover"
                  @click="closeSidebar"
                >
                  <span class="i-lucide-x w-5 h-5 text-secondary" />
                </button>
              </div>
              <PreviewSidebar
                :tree="tree"
                :active-chapter="activeChapter"
                :has-parts="hasParts"
                @select-chapter="navigateAndClose"
                @select-section="(p) => navigateAndClose(p.chNum)"
                @select-cover="() => navigateAndClose(0)"
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
        @navigate="(p) => navigateToChapter(p.chNum, p.anchorId)"
      />
      <div v-else class="flex-1 flex items-center justify-center text-muted text-sm">
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
          <label class="text-xs text-secondary mb-1 block">变更说明</label>
          <input
            v-model="publishChangeNotes"
            class="input text-sm"
            placeholder="本次发布的内容..."
            @keyup.enter="doPublish"
          />
        </div>
        <div>
          <label class="text-xs text-secondary mb-1 block">文档可见性</label>
          <div class="flex gap-2">
            <button
              v-for="opt in visibilityOptions"
              :key="opt.value"
              class="px-3 py-1.5 rounded border text-xs transition-colors"
              :class="
                publishVisibility === opt.value
                  ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700/40 color-accent'
                  : 'border-input hover:bg-hover'
              "
              @click="() => (publishVisibility = opt.value)"
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
                reviewStats.approved === reviewStats.total
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-yellow-600 dark:text-yellow-400'
              "
            >
              {{ reviewStats.approved }} / {{ reviewStats.total }}
            </span>
            小节已通过
          </span>
        </div>
        <CheckboxField
          v-model="publishApprovedOnly"
          label="仅发布已审核内容（未审核的小节将不包含在文档中）"
        />
      </div>
    </ModalDialog>

    <!-- 版本设置弹窗 -->
    <ModalDialog
      :visible="versionSettingsVisible"
      title="版本设置"
      confirm-text="保存"
      cancel-text="取消"
      :error="settingsError"
      :loading="settingsSaving"
      @close="versionSettingsVisible = false"
      @confirm="saveVersionSettings"
    >
      <div class="space-y-5 min-w-64">
        <!-- 可见性 -->
        <div>
          <label class="text-xs text-secondary mb-2 block font-medium">文档可见性</label>
          <div class="flex gap-2">
            <button
              v-for="opt in visibilityOptions"
              :key="opt.value"
              class="px-3 py-1.5 rounded border text-xs transition-colors"
              :class="
                settingsVisibility === opt.value
                  ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700/40 color-accent font-medium'
                  : 'border-input hover:bg-hover'
              "
              @click="() => (settingsVisibility = opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <!-- 状态 -->
        <div>
          <label class="text-xs text-secondary mb-2 block font-medium">版本状态</label>
          <div class="flex gap-2">
            <button
              v-for="opt in statusOptions"
              :key="opt.value"
              class="px-3 py-1.5 rounded border text-xs transition-colors"
              :class="
                settingsStatus === opt.value
                  ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700/40 color-accent font-medium'
                  : 'border-input hover:bg-hover'
              "
              @click="() => (settingsStatus = opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
          <p class="text-xs text-muted mt-1.5">
            <template v-if="settingsStatus === 'deprecated'">
              废弃版本仍可查看，但会显示提示横幅
            </template>
            <template v-else-if="settingsStatus === 'archived'">
              归档版本将在版本列表中隐藏（仅管理端可见）
            </template>
            <template v-else> 正常可用状态 </template>
          </p>
        </div>
      </div>
      <template #footer-actions>
        <button
          class="flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-300 text-xs color-danger hover:bg-danger transition-colors sm:order-first sm:mr-auto"
          @click="doDeleteFromSettings"
        >
          <span class="i-lucide-trash-2 w-3.5 h-3.5 inline-block align-middle" />
          删除
        </button>
      </template>
    </ModalDialog>
  </div>

  <VersionDiff
    :visible="diffVisible"
    :catalog-id="selectedCatalogId || ''"
    :versions="versions"
    @close="diffVisible = false"
  />

  <!-- PDF 导出进度弹窗 -->
  <Teleport to="body">
    <div
      v-if="showPdfProgress"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-black/30"
    >
      <div
        class="bg-surface rounded-xl shadow-2xl border border-default px-8 py-6 min-w-[300px] text-center"
      >
        <span
          class="i-lucide-loader-2 w-8 h-8 animate-spin text-[var(--c-accent)] mx-auto block mb-4"
        />
        <p class="text-sm text-secondary">{{ pdfProgressMessage }}</p>
        <p class="text-xs text-muted mt-2">请稍候，PDF 生成可能需要一些时间</p>
      </div>
    </div>
  </Teleport>
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
