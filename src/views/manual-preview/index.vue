<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProject } from '@/composables/useProject'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import SelectDropdown from '@/components/SelectDropdown.vue'
import LoadingState from '@/components/LoadingState.vue'

const route = useRoute()
const router = useRouter()
const { currentProjectId } = useProject()
const { isPM } = useAuth()
const { prompt, alert } = useDialog()

// ====== 目录列表 ======
interface CatalogItem { id: string; title: string; updated_at: string }
const catalogs = ref<CatalogItem[]>([])
const selectedCatalogId = ref<string | null>(null)

async function loadCatalogs() {
  const token = localStorage.getItem('auth_token')
  const pid = currentProjectId.value
  const url = pid ? `/api/catalogs?projectId=${pid}` : '/api/catalogs'
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      catalogs.value = await res.json()
      // 默认选中：URL params（/preview/:id）> URL query（?catalog=）> 第一个
      const fromParam = route.params.id as string | undefined
      const fromQuery = route.query.catalog as string | undefined
      const fromUrl = fromParam || fromQuery
      if (fromUrl && catalogs.value.some(c => c.id === fromUrl)) {
        selectedCatalogId.value = fromUrl
      } else if (catalogs.value.length > 0) {
        selectedCatalogId.value = catalogs.value[0].id
        router.replace(`/preview/${catalogs.value[0].id}`)
      } else {
        selectedCatalogId.value = null
        router.replace({ query: {} })
      }
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
interface VersionItem {
  id: string; version_major: number; version_minor: number
  title: string; change_notes: string; created_at: string
}
const versions = ref<VersionItem[]>([])
const selectedVersionId = ref<string | null>(null)

async function loadVersions() {
  if (!selectedCatalogId.value) { versions.value = []; selectedVersionId.value = null; return }
  const token = localStorage.getItem('auth_token')
  try {
    const res = await fetch(`/api/catalogs/${selectedCatalogId.value}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      versions.value = await res.json()
      const fromUrl = route.query.version as string | undefined
      selectedVersionId.value = (fromUrl && versions.value.some(v => v.id === fromUrl)) ? fromUrl : null
    }
  } catch { /* ignore */ }
}

function selectVersion(id: string | number | null) {
  selectedVersionId.value = id ? id as string : null
  const query: Record<string, string> = { catalog: selectedCatalogId.value! }
  if (id) query.version = id as string
  router.replace({ query })
}

// ====== 预览 ======
const catalogTitle = ref('')
const bodyHtml = ref('')
const loading = ref(true)
const previewMode = ref<'all' | 'approved'>('all')
const notFound = ref(false)

async function loadPreview() {
  if (!selectedCatalogId.value) { bodyHtml.value = ''; loading.value = false; return }
  loading.value = true
  notFound.value = false
  const token = localStorage.getItem('auth_token')
  try {
    if (selectedVersionId.value) {
      const res = await fetch(
        `/api/catalogs/${selectedCatalogId.value}/versions/${selectedVersionId.value}/preview?mode=${previewMode.value}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) { notFound.value = true; return }
      const data = await res.json()
      bodyHtml.value = renderMarkdown(data.markdown)
      catalogTitle.value = data.title
    } else {
      const res = await fetch(
        `/api/catalogs/${selectedCatalogId.value}/preview?mode=${previewMode.value}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) { notFound.value = true; return }
      const manual = await res.json()
      bodyHtml.value = renderMarkdown(manual.markdown)
      catalogTitle.value = manual.catalog.title
    }
  } finally {
    loading.value = false
  }
}

// ====== 操作 ======
const exporting = ref(false)
const exportingMd = ref(false)
const publishing = ref(false)

async function publishVersion() {
  const changeNotes = await prompt('变更说明：')
  if (changeNotes === null) return
  publishing.value = true
  const token = localStorage.getItem('auth_token')
  try {
    const res = await fetch(`/api/catalogs/${selectedCatalogId.value}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ changeNotes }),
    })
    if (!res.ok) { const err = await res.json().catch(() => ({ error: '发布失败' })); await alert(err.error || '发布失败'); return }
    const data = await res.json()
    await loadVersions()
    await alert(`版本 v${data.versionMajor}.${data.versionMinor} 已发布`)
  } catch (e: unknown) {
    await alert('发布失败: ' + (e instanceof Error ? e.message : '网络错误'))
  } finally { publishing.value = false }
}

async function exportDraft() {
  if (!selectedCatalogId.value) return
  exporting.value = true
  const token = localStorage.getItem('auth_token')
  try {
    const res = await fetch(`/api/catalogs/${selectedCatalogId.value}/export?mode=${previewMode.value}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) { const err = await res.json().catch(() => ({ error: '导出失败' })); await alert(err.error || '导出失败'); return }
    downloadBlob(res)
  } catch (e: unknown) { await alert('导出失败: ' + (e instanceof Error ? e.message : '网络错误')) }
  finally { exporting.value = false }
}

async function downloadVersion() {
  if (!selectedVersionId.value || !selectedCatalogId.value) return
  exporting.value = true
  const token = localStorage.getItem('auth_token')
  try {
    const res = await fetch(
      `/api/catalogs/${selectedCatalogId.value}/versions/${selectedVersionId.value}/export?mode=${previewMode.value}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) { const err = await res.json().catch(() => ({ error: '下载失败' })); await alert(err.error || '下载失败'); return }
    downloadBlob(res)
  } catch (e: unknown) { await alert('下载失败: ' + (e instanceof Error ? e.message : '网络错误')) }
  finally { exporting.value = false }
}

function downloadBlob(res: Response) {
  const d = res.headers.get('Content-Disposition') || ''
  const m = d.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
  const filename = m?.[1]?.replace(/['"]/g, '') || 'manual.pdf'
  res.blob().then(blob => {
    const u = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = u; a.download = decodeURIComponent(filename); a.click()
    URL.revokeObjectURL(u)
  })
}

async function exportMarkdown() {
  if (!selectedCatalogId.value) return
  exportingMd.value = true
  const token = localStorage.getItem('auth_token')
  try {
    const res = await fetch(`/api/catalogs/${selectedCatalogId.value}/export/markdown`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) { const err = await res.json().catch(() => ({ error: '导出失败' })); await alert(err.error || '导出失败'); return }
    downloadBlob(res)
  } catch (e: unknown) { await alert('导出失败: ' + (e instanceof Error ? e.message : '网络错误')) }
  finally { exportingMd.value = false }
}

// ====== Markdown 渲染 ======
function escapeHtml(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

function renderMarkdown(md: string): string {
  let html = md
    .replace(/<crossref\s+[^>]*(?:data-feature-id|featureid|featureId)="([^"]+)"[^>]*>(?:[^<]*)<\/crossref>/gi,
      (_m, fid: string) => { const lm = _m.match(/(?:data-label|label)="([^"]*)"/i); return `<a href="#feature-${fid}" class="crossref-link">→ 参见：${escapeHtml(lm?.[1] || fid)}</a>` })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')
  html = '<p>' + html + '</p>'
  html = html.replace(/<p><h([1-4])>/g, '<h$1>').replace(/<\/h([1-4])><\/p>/g, '</h$1>')
  html = html.replace(/<p><hr><\/p>/g, '<hr>')
  html = html.replace(/<p><blockquote>/g, '<blockquote>').replace(/<\/blockquote><\/p>/g, '</blockquote>')
  html = html.replace(/<p><(ul|ol|pre)\b/g, '<$1').replace(/<\/(ul|ol|pre)>\s*<\/p>/g, '</$1>')
  return html
}

// ====== 变更记录 ======
const changelogVersions = computed(() => {
  if (!selectedVersionId.value) return versions.value
  const t = versions.value.find(v => v.id === selectedVersionId.value)
  if (!t) return versions.value
  return versions.value.filter(v => v.version_major < t.version_major || (v.version_major === t.version_major && v.version_minor <= t.version_minor))
})

// ====== 生命周期 ======
async function reloadAll() { await loadCatalogs(); await loadVersions(); await loadPreview() }
onMounted(reloadAll)

// 项目切换：重载目录列表
watch(currentProjectId, () => { reloadAll() })

// 目录切换：重载版本 + 预览
watch(selectedCatalogId, () => { loadVersions().then(loadPreview) })

// 版本 / 模式切换：重载预览
watch([selectedVersionId, previewMode], () => { loadPreview() })
</script>

<template>
  <div class="h-full flex flex-col bg-gray-100">
    <!-- 顶部操作栏 -->
    <header class="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between z-10">
      <div class="flex items-center gap-4 min-w-0">
        <h1 class="text-lg font-semibold flex-shrink-0">{{ catalogTitle || '手册预览' }}</h1>

        <!-- 目录选择器 -->
        <SelectDropdown
          v-if="catalogs.length > 0"
          width-class="w-48"
          placeholder="选择目录"
          :model-value="selectedCatalogId || ''"
          :options="catalogs.map(c => ({ value: c.id, label: c.title }))"
          @update:model-value="selectCatalog"
        />

        <!-- 版本选择器 -->
        <SelectDropdown
          v-if="selectedCatalogId && versions.length > 0"
          width-class="w-56"
          placeholder="当前最新（实时内容）"
          :model-value="selectedVersionId || ''"
          :options="[
            { value: '', label: '当前最新（实时内容）' },
            ...versions.map(v => ({ value: v.id, label: `v${v.version_major}.${v.version_minor} · ${v.created_at.slice(0, 10)}` }))
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

        <!-- PM：实时内容 → 发布 + 导出草稿 + 编排 -->
        <template v-if="isPM && selectedCatalogId && !selectedVersionId">
          <button class="btn-secondary text-sm" :disabled="publishing" @click="publishVersion">
            <span v-if="publishing" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />发布版本
          </button>
          <button class="btn-primary text-sm" :disabled="exporting" @click="exportDraft">
            <span v-if="exporting" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />导出草稿
          </button>
          <button class="btn-secondary text-sm" :disabled="exportingMd" @click="exportMarkdown">
            <span v-if="exportingMd" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />下载 MD
          </button>
          <router-link :to="`/catalogs/${selectedCatalogId}`" class="btn-secondary text-sm">编排</router-link>
        </template>

        <!-- PM：历史版本 → 下载 + 编排 -->
        <template v-if="isPM && selectedCatalogId && selectedVersionId">
          <button class="btn-primary text-sm" :disabled="exporting" @click="downloadVersion">
            <span v-if="exporting" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />下载
          </button>
          <button class="btn-secondary text-sm" :disabled="exportingMd" @click="exportMarkdown">
            <span v-if="exportingMd" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />下载 MD
          </button>
          <router-link :to="`/catalogs/${selectedCatalogId}`" class="btn-secondary text-sm">编排</router-link>
        </template>

        <!-- 运维：仅历史版本可下载 -->
        <template v-if="!isPM && selectedCatalogId">
          <button class="btn-primary text-sm" :disabled="exporting || !selectedVersionId"
            :title="!selectedVersionId ? '请先选择一个已发布版本' : ''" @click="downloadVersion">
            <span v-if="exporting" class="i-lucide-loader-2 w-4 h-4 inline-block align-middle animate-spin mr-1" />下载
          </button>
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
        <router-link v-if="isPM" to="/catalogs/new" class="btn-primary text-sm mt-3 inline-block">新建目录</router-link>
      </div>
    </div>

    <!-- 手册内容 -->
    <div v-else-if="bodyHtml" class="flex-1 overflow-y-auto">
      <div class="max-w-4xl mx-auto py-8 px-6">
        <div class="bg-white rounded-xl shadow-sm p-8 mb-6">
          <div class="manual-content" v-html="bodyHtml" />
        </div>
        <div v-if="changelogVersions.length > 0" class="bg-white rounded-xl shadow-sm p-8 mb-6">
          <h2 class="text-lg font-semibold mb-4">变更记录</h2>
          <div class="space-y-3">
            <div v-for="v in changelogVersions" :key="v.id"
              class="flex items-start gap-3 text-sm border-b border-gray-50 pb-2"
              :class="{ 'cursor-pointer text-blue-600 hover:text-blue-800': v.id !== selectedVersionId }"
              @click="v.id !== selectedVersionId && selectVersion(v.id)">
              <span class="font-mono text-gray-500 flex-shrink-0">v{{ v.version_major }}.{{ v.version_minor }}</span>
              <span class="text-gray-400 flex-shrink-0">{{ v.created_at.slice(0, 10) }}</span>
              <span class="text-gray-600">{{ v.change_notes || '（无变更说明）' }}</span>
            </div>
          </div>
        </div>
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
.manual-content :deep(table) { table-layout: fixed; width: 100%; }
.manual-content :deep(td) { overflow-wrap: break-word; }
.manual-content :deep(.crossref-link) { color: #2563eb; background: #eff6ff; padding: 0.1em 0.4em; border-radius: 0.25em; font-size: 0.9em; text-decoration: none; white-space: nowrap; }
.manual-content :deep(.crossref-link:hover) { text-decoration: underline; background: #dbeafe; }
</style>
