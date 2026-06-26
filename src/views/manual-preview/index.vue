<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProject } from '@/composables/useProject'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import { useSidebarTree } from '@/composables/useSidebarTree'
import { getCatalogs, getPreview, getVersions, getVersionPreview, publishCatalog, updateVersionVisibility, getMarkdownExportUrl } from '@/api/endpoints/catalogs'
import { api } from '@/api/client'
import type { CatalogInfo, CatalogVersionInfo, CatalogEntry } from '@shared/types'
import SelectDropdown from '@/components/SelectDropdown.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import LoadingState from '@/components/LoadingState.vue'
import PreviewSidebar from './PreviewSidebar.vue'
import PreviewContent from './PreviewContent.vue'

const route = useRoute()
const router = useRouter()
const { currentProjectId } = useProject()
const { canManageProject } = useAuth()
const { alert } = useDialog()

// ====== 目录列表 ======
const catalogs = ref<CatalogInfo[]>([])
const selectedCatalogId = ref<string | null>(null)

async function loadCatalogs() {
  const pid = currentProjectId.value
  try {
    const data = await getCatalogs(pid || undefined)
    catalogs.value = data
    const fromParam = route.params.id as string | undefined
    const fromQuery = route.query.catalog as string | undefined
    const fromUrl = fromParam || fromQuery
    if (fromUrl && catalogs.value.some((c: CatalogInfo) => c.id === fromUrl)) {
      selectedCatalogId.value = fromUrl
    } else if (catalogs.value.length > 0) {
      selectedCatalogId.value = catalogs.value[0].id
      router.replace(`/preview/${catalogs.value[0].id}`)
    } else {
      selectedCatalogId.value = null
      router.replace({ query: {} })
    }
  } catch { /* ignore */ }
}

function selectCatalog(id: string | number | null) {
  if (!id) return
  selectedCatalogId.value = id as string
  selectedVersionId.value = null
  router.replace(`/preview/${id}`)
}

// ====== 版本列表 ======
const versions = ref<CatalogVersionInfo[]>([])
const selectedVersionId = ref<string | null>(null)

async function loadVersions() {
  if (!selectedCatalogId.value) { versions.value = []; selectedVersionId.value = null; return }
  try {
    const data = await getVersions(selectedCatalogId.value)
    versions.value = data
    const fromUrl = route.query.version as string | undefined
    selectedVersionId.value = (fromUrl && versions.value.some((v: CatalogVersionInfo) => v.id === fromUrl)) ? fromUrl : null
  } catch { /* ignore */ }
}

function selectVersion(id: string | number | null) {
  selectedVersionId.value = id ? id as string : null
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
}>({
  title: '',
  features: [],
  entries: [],
})

// 侧边栏树
const { tree, chapterMap, hasParts, totalChapters } = useSidebarTree(
  computed(() => previewData.value.entries),
  computed(() => previewData.value.features),
)

// 当前章节
const activeChapter = ref<number | null>(null)

// 从 URL hash 恢复章节
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

// 章节切换
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
      const data = await getVersionPreview(selectedCatalogId.value, selectedVersionId.value, previewMode.value)
      catalogTitle.value = data.title
      previewData.value = {
        title: data.title,
        features: data.features || [],
        entries: data.entries || [],
      }
    } else {
      const data = await getPreview(selectedCatalogId.value, previewMode.value)
      catalogTitle.value = data.catalog.title
      previewData.value = {
        title: data.catalog.title,
        features: data.features,
        entries: data.catalog.entries || [],
      }
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
  publishError.value = ''
  publishDialogVisible.value = true
}

async function doPublish() {
  if (!publishChangeNotes.value.trim()) {
    publishError.value = '请输入变更说明'
    return
  }
  publishing.value = true
  publishError.value = ''
  try {
    const data = await publishCatalog(selectedCatalogId.value!, publishChangeNotes.value.trim(), publishVisibility.value)
    publishDialogVisible.value = false
    await loadVersions()
    await alert(`版本 v${data.versionMajor}.${data.versionMinor} 已发布`)
  } catch (e: unknown) {
    publishError.value = e instanceof Error ? e.message : '网络错误'
  } finally { publishing.value = false }
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
  } catch (e: unknown) { await alert('导出失败: ' + (e instanceof Error ? e.message : '网络错误')) }
  finally { exportingMd.value = false }
}

// ====== 变更记录 ======
const changelogVersions = computed(() => {
  if (!selectedVersionId.value) return versions.value
  const t = versions.value.find((v: CatalogVersionInfo) => v.id === selectedVersionId.value)
  if (!t) return versions.value
  return versions.value.filter((v: CatalogVersionInfo) =>
    v.versionMajor < t.versionMajor ||
    (v.versionMajor === t.versionMajor && v.versionMinor <= t.versionMinor),
  )
})

const currentVersionVis = computed(() => {
  const v = versions.value.find((v: CatalogVersionInfo) => v.id === selectedVersionId.value)
  return v?.visibility || 'project_members'
})

const docUrl = computed(() => {
  const v = versions.value.find((v: CatalogVersionInfo) => v.id === selectedVersionId.value)
  if (!v) return ''
  return `/docs/${selectedCatalogId.value}/v${v.versionMajor}.${v.versionMinor}/`
})

// ====== 生命周期 ======
async function reloadAll() { await loadCatalogs(); await loadVersions(); await loadPreview() }
onMounted(reloadAll)

watch(currentProjectId, () => { reloadAll() })
watch(selectedCatalogId, () => { loadVersions().then(loadPreview) })
watch([selectedVersionId, previewMode], () => { loadPreview() })
watch(catalogTitle, (t) => { if (t) document.title = t })
onUnmounted(() => { document.title = '操作手册编写平台' })

// URL hash 变化 → 切换章节
window.addEventListener('hashchange', () => {
  syncChapterFromHash()
})
</script>

<template>
  <div class="h-full flex flex-col bg-gray-100">
    <!-- 顶部操作栏 -->
    <header class="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between z-10">
      <div class="flex items-center gap-4 min-w-0">
        <SelectDropdown
          v-if="catalogs.length > 0"
          width-class="w-48"
          placeholder="选择目录"
          :model-value="selectedCatalogId || ''"
          :options="catalogs.map(c => ({ value: c.id, label: c.title }))"
          @update:model-value="selectCatalog"
        />
        <h1 v-else class="text-lg font-semibold flex-shrink-0">{{ catalogTitle || '手册预览' }}</h1>

        <SelectDropdown
          v-if="selectedCatalogId && versions.length > 0"
          width-class="w-64"
          placeholder="当前最新（实时内容）"
          :model-value="selectedVersionId || ''"
          :options="[
            { value: '', label: '当前最新（实时内容）' },
            ...versions.map(v => {
              const vis = visibilityLabels[v.visibility] || '项目成员'
              return { value: v.id, label: `v${v.versionMajor}.${v.versionMinor} · ${v.createdAt.slice(0, 10)} · ${vis}` }
            }),
          ]"
          @update:model-value="selectVersion"
        />
      </div>

      <div class="flex items-center gap-3 flex-shrink-0">
        <SelectDropdown
          width-class="w-36" placeholder="全部" :model-value="previewMode"
          :options="[{ value: 'all', label: '全部章节' }, { value: 'approved', label: '仅已审核' }]"
          @update:model-value="(val: string | number | null) => previewMode = (val as 'all' | 'approved') || 'all'"
        />

        <!-- PM：实时内容 → 发布 + 编排 -->
        <template v-if="canManageProject && selectedCatalogId && !selectedVersionId">
          <button class="btn-secondary text-sm" :disabled="publishing" @click="openPublishDialog">
            <span v-if="publishing" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />发布版本
          </button>
          <button class="btn-secondary text-sm" :disabled="exportingMd" @click="exportMarkdown">
            <span v-if="exportingMd" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />下载 MD
          </button>
          <router-link :to="`/catalogs/${selectedCatalogId}`" class="btn-secondary text-sm">编排</router-link>
        </template>

        <!-- PM：历史版本 → 下载 + 编排 -->
        <template v-if="canManageProject && selectedCatalogId && selectedVersionId">
          <SelectDropdown
            width-class="w-28"
            :model-value="currentVersionVis"
            :options="visibilityOptions"
            @update:model-value="(val: string | number | null) => updateVisibility(selectedVersionId!, val as string)"
          />
          <div class="w-px h-5 bg-gray-300 mx-1" />
          <a v-if="selectedVersionId" :href="docUrl" target="_blank" class="btn-secondary text-sm">在线文档</a>
          <button class="btn-secondary text-sm" :disabled="exportingMd" @click="exportMarkdown">
            <span v-if="exportingMd" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />下载 MD
          </button>
          <router-link :to="`/catalogs/${selectedCatalogId}`" class="btn-secondary text-sm">编排</router-link>
        </template>

        <!-- 运维：仅历史版本可下载 -->
        <template v-if="!canManageProject && selectedCatalogId">
          <span v-if="selectedVersionId" class="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
            :class="currentVersionVis === 'public' ? 'bg-green-100 text-green-700' : currentVersionVis === 'login_required' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'">
            {{ visibilityLabels[currentVersionVis] || '项目成员' }}
          </span>
          <div v-if="selectedVersionId" class="w-px h-5 bg-gray-300 mx-1" />
          <a v-if="selectedVersionId" :href="docUrl" target="_blank" class="btn-secondary text-sm">在线文档</a>
          <button class="btn-secondary text-sm" :disabled="exportingMd" @click="exportMarkdown">
            <span v-if="exportingMd" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />下载 MD
          </button>
        </template>
      </div>
    </header>

    <LoadingState v-if="loading" />

    <!-- 无目录 -->
    <div v-else-if="catalogs.length === 0" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <span class="i-lucide-book-open text-4xl text-gray-300 mb-3 block mx-auto" />
        <p class="text-gray-500 text-sm">当前项目暂无目录</p>
        <router-link v-if="canManageProject" to="/catalogs/new" class="btn-primary text-sm mt-3 inline-block">新建目录</router-link>
      </div>
    </div>

    <!-- 手册内容：左右布局 -->
    <div v-else-if="previewData.entries.length > 0 || previewData.features.length > 0" class="flex-1 flex overflow-hidden">
      <PreviewSidebar
        :tree="tree"
        :active-chapter="activeChapter"
        :has-parts="hasParts"
        @select-chapter="navigateToChapter"
        @select-section="navigateToChapter"
        @select-cover="navigateToChapter(0)"
      />
      <PreviewContent
        v-if="activeChapter !== null"
        :catalog-id="selectedCatalogId"
        :version-id="selectedVersionId"
        :preview-mode="previewMode"
        :ch-num="activeChapter"
        :total-chapters="totalChapters"
        :catalog-title="catalogTitle"
        :tree="tree"
        :has-parts="hasParts"
        :changelog="changelogVersions"
        :selected-version-id="selectedVersionId"
        :on-select-version="selectVersion"
        @navigate="navigateToChapter"
      />
      <div v-else class="flex-1 flex items-center justify-center text-gray-400 text-sm">
        无法定位章节
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
              :class="publishVisibility === opt.value ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-gray-300 hover:bg-gray-100'"
              @click="publishVisibility = opt.value"
            >{{ opt.label }}</button>
          </div>
        </div>
      </div>
    </ModalDialog>
  </div>
</template>

<style scoped>
@media print {
  header { display: none !important; }
}
</style>
