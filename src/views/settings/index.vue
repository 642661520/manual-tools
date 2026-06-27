<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { useDialog } from '@/composables/useDialog'
import * as authApi from '@/api/endpoints/auth'
import * as projectApi from '@/api/endpoints/projects'
import * as dataApi from '@/api/endpoints/data-tasks'
import * as cacheApi from '@/api/endpoints/cache'
import type { UserDetail, OrphanFile, UploadFileInfo } from '@shared/types'
import ModalDialog from '@/components/ModalDialog.vue'
import FormField from '@/components/FormField.vue'
import SelectDropdown from '@/components/SelectDropdown.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import Paginator from '@/components/Paginator.vue'
import SettingsSidebar from '@/components/SettingsSidebar.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import PasswordInput from '@/components/PasswordInput.vue'
import AuditLog from './AuditLog.vue'

const route = useRoute()
const router = useRouter()
const { isAdmin } = useAuth()
const { projects, loadProjects } = useProject()
const { confirm, dangerConfirm } = useDialog()

type Tab = 'projects' | 'users' | 'backup' | 'storage' | 'audit'
const validTabs: Tab[] = ['projects', 'users', 'backup', 'storage', 'audit']
const activeTab = ref<Tab>(validTabs.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'projects')

const settingsTabs = [
  { key: 'projects', label: '项目管理', icon: 'i-lucide-folder' },
  { key: 'users', label: '账号管理', icon: 'i-lucide-users' },
  { key: 'backup', label: '备份恢复', icon: 'i-lucide-database' },
  { key: 'storage', label: '存储与缓存', icon: 'i-lucide-hard-drive' },
  { key: 'audit', label: '操作日志', icon: 'i-lucide-scroll-text' },
]

// ===== 用户管理 =====
const localUsers = ref<UserDetail[]>([])
const showAddUser = ref(false)
const addUserError = ref('')
const newUser = ref({ username: '', displayName: '', password: '', role: 'member' })

async function loadUsers() {
  try {
    localUsers.value = await authApi.getUsers()
  } catch { /* ignore */ }
}

async function addUser() {
  addUserError.value = ''
  if (!newUser.value.username.trim()) {
    addUserError.value = '用户名不能为空'
    return
  }

  const pw = newUser.value.password
  if (!pw) { addUserError.value = '请输入密码'; return }
  if (pw.length < 8) { addUserError.value = '密码不能少于8位'; return }
  if (pw.length > 128) { addUserError.value = '密码不能超过128位'; return }

  let categories = 0
  if (/[A-Z]/.test(pw)) categories++
  if (/[a-z]/.test(pw)) categories++
  if (/[0-9]/.test(pw)) categories++
  if (/[^A-Za-z0-9]/.test(pw)) categories++

  if (categories < 3) {
    addUserError.value = '密码需包含大写字母、小写字母、数字、特殊字符中至少3种'
    return
  }
  try {
    await authApi.createUser(newUser.value)
    showAddUser.value = false
    newUser.value = { username: '', displayName: '', password: '', role: 'member' }
    await loadUsers()
  } catch (e: unknown) {
    addUserError.value = e instanceof Error ? e.message : '网络错误，添加失败'
  }
}

async function deleteUser(id: string) {
  if (!await dangerConfirm('确定删除此用户？')) return
  try {
    await authApi.deleteUser(id)
    await loadUsers()
  } catch { /* ignore */ }
}

async function changeUserRole(userId: string, newRole: string) {
  try {
    await authApi.changeUserRole(userId, newRole)
    await loadUsers()
  } catch { /* ignore */ }
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = { admin: '系统管理员', member: '成员', guest: '游客' }
  return labels[role] || role
}

const roleOptions = [
  { value: 'guest', label: '游客' },
  { value: 'member', label: '成员' },
  { value: 'admin', label: '系统管理员' },
]

// ===== 项目管理 =====
const showAddProject = ref(false)
const projectError = ref('')
const editingProject = ref<{ id: string; name: string; description: string } | null>(null)
const newProject = ref({ name: '', description: '' })
const editProjectForm = ref({ name: '', description: '' })

async function createProject() {
  projectError.value = ''
  if (!newProject.value.name.trim()) {
    projectError.value = '请输入项目名称'
    return
  }
  try {
    await projectApi.createProject(newProject.value)
    showAddProject.value = false
    newProject.value = { name: '', description: '' }
    await loadProjects()
  } catch (e: unknown) {
    projectError.value = e instanceof Error ? e.message : '网络错误，创建失败'
  }
}

function openEditProject(p: { id: string; name: string; description: string }) {
  editingProject.value = p
  editProjectForm.value = { name: p.name, description: p.description }
}

async function saveEditProject() {
  projectError.value = ''
  if (!editingProject.value || !editProjectForm.value.name.trim()) {
    projectError.value = '请输入项目名称'
    return
  }
  try {
    await projectApi.updateProject(editingProject.value.id, editProjectForm.value)
    editingProject.value = null
    await loadProjects()
  } catch (e: unknown) {
    projectError.value = e instanceof Error ? e.message : '网络错误，保存失败'
  }
}

async function deleteProject(id: string) {
  if (!await dangerConfirm('确定删除此项目？项目下所有章节和目录将被一并删除。')) return
  try {
    await projectApi.deleteProject(id)
    await loadProjects()
    await nextTick()
  } catch { /* ignore */ }
}

// ===== 系统备份 =====
const backupTaskId = ref('')
const backupRunning = ref(false)
const backupLink = ref('')

async function startSystemBackup() {
  backupRunning.value = true
  try {
    const { taskId } = await dataApi.startSystemExport()
    backupTaskId.value = taskId
    let attempts = 0
    while (attempts < 30) {
      await new Promise(r => setTimeout(r, 1000))
      const tasks = await dataApi.listTasks()
      const task = tasks.find(t => t.id === taskId)
      if (task?.status === 'completed') {
        backupLink.value = `/api/v1/data-tasks/${taskId}/download`
        return
      }
      if (task?.status === 'failed') {
        backupError.value = '备份失败'
        return
      }
      attempts++
    }
    backupError.value = '备份超时'
  } catch (e: unknown) {
    backupError.value = e instanceof Error ? e.message : '备份出错'
  } finally {
    backupRunning.value = false
  }
}

const backupError = ref('')

// ===== 存储清理 =====
const orphans = ref<OrphanFile[]>([])
const orphansTotalSize = ref(0)
const orphansLoading = ref(false)
const orphansError = ref('')
const cleanResult = ref<{ deleted: number } | null>(null)

async function loadOrphans() {
  orphansLoading.value = true
  orphansError.value = ''
  try {
    const data = await dataApi.getOrphans()
    orphans.value = data.orphans
    orphansTotalSize.value = data.totalSize
  } catch (e: unknown) {
    orphansError.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    orphansLoading.value = false
  }
}

async function handleCleanOrphans() {
  if (!await dangerConfirm(`确定清理 ${orphans.value.length} 个孤立文件（${formatSize(orphansTotalSize.value)}）？此操作不可撤销。`)) return
  try {
    cleanResult.value = await dataApi.deleteOrphans()
    await loadOrphans()
  } catch (e: unknown) {
    orphansError.value = e instanceof Error ? e.message : '清理失败'
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ===== 上传资源管理 =====
const uploadFiles = ref<UploadFileInfo[]>([])
const uploadFilesTotalSize = ref(0)
const uploadFilesTotalCount = ref(0)
const uploadFilesReferencedCount = ref(0)
const uploadFilesOrphanedCount = ref(0)
const uploadFilesLoading = ref(false)
const uploadFilesError = ref('')
const uploadFilesResult = ref<string>('')
const showUploadFiles = ref(false)
const uploadPreviewFile = ref<UploadFileInfo | null>(null)

/** 获取上传文件预览 URL */
function getUploadPreviewUrl(file: UploadFileInfo): string {
  return `/uploads/${file.path}`
}

function openUploadPreview(file: UploadFileInfo) {
  if (isImagePath(file.path) || isVideoPath(file.path)) {
    uploadPreviewFile.value = file
  }
}

function closeUploadPreview() {
  uploadPreviewFile.value = null
}

async function loadUploadFiles() {
  uploadFilesLoading.value = true
  uploadFilesError.value = ''
  try {
    const data = await dataApi.getUploads()
    uploadFiles.value = data.files
    uploadFilesTotalSize.value = data.totalSize
    uploadFilesTotalCount.value = data.totalCount
    uploadFilesReferencedCount.value = data.referencedCount
    uploadFilesOrphanedCount.value = data.orphanedCount
    showUploadFiles.value = true
  } catch (e: unknown) {
    uploadFilesError.value = e instanceof Error ? e.message : '加载上传资源失败'
  } finally {
    uploadFilesLoading.value = false
  }
}

function toggleUploadFiles() {
  if (showUploadFiles.value) {
    showUploadFiles.value = false
  } else {
    loadUploadFiles()
  }
}

async function handleDeleteUploadFile(file: UploadFileInfo) {
  if (!await dangerConfirm(`确定删除「${file.path}」？\n${formatSize(file.size)}${file.referenced ? '\n⚠️ 该文件仍被文档引用，删除后文档中将无法显示。' : ''}`)) return
  try {
    await dataApi.deleteUpload(file.path)
    uploadFilesResult.value = `已删除: ${file.path}`
    await loadUploadFiles()
    await loadOrphans()
  } catch (e: unknown) {
    uploadFilesError.value = e instanceof Error ? e.message : '删除失败'
  }
}

async function handleCleanAllOrphans() {
  const count = uploadFilesOrphanedCount.value
  if (count === 0) return
  if (!await dangerConfirm(`确定清理全部 ${count} 个未被引用的文件？此操作不可撤销。`)) return
  try {
    const result = await dataApi.deleteOrphans()
    uploadFilesResult.value = `已清理 ${result.deleted} 个文件，释放 ${formatSize(result.freedBytes)}`
    await loadUploadFiles()
    await loadOrphans()
  } catch (e: unknown) {
    uploadFilesError.value = e instanceof Error ? e.message : '清理失败'
  }
}

/** 判断是否为图片 */
function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(p)
}

/** 判断是否为视频 */
function isVideoPath(p: string): boolean {
  return /\.(mp4|webm)$/i.test(p)
}

// ===== 缓存管理 =====
const cacheStats = ref<cacheApi.CacheInfo | null>(null)
const cacheStatsLoading = ref(false)
const cacheStatsError = ref('')
const exportEntries = ref<cacheApi.ExportCacheEntry[]>([])
const remoteEntries = ref<cacheApi.RemoteCacheEntry[]>([])
const remoteTotal = ref(0)
const remoteOffset = ref(0)
const remotePageSize = 10
const cacheEntriesLoading = ref(false)
const cacheCleanResult = ref<string>('')
const cacheCleaning = ref(false)
const showExportDetail = ref(false)
const showRemoteDetail = ref(false)
const previewEntry = ref<cacheApi.RemoteCacheEntry | null>(null)
const previewBlobUrl = ref<string>('')

const blobUrlCache = reactive(new Map<string, string>())
const MAX_BLOB_CACHE = 50

/** 清理最旧的 blob URL（LRU 策略） */
function evictOldBlobs() {
  while (blobUrlCache.size >= MAX_BLOB_CACHE) {
    const oldestKey = blobUrlCache.keys().next().value
    if (oldestKey) {
      URL.revokeObjectURL(blobUrlCache.get(oldestKey)!)
      blobUrlCache.delete(oldestKey)
    } else break
  }
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}

function isVideoMime(mime: string): boolean {
  return mime.startsWith('video/')
}

function getCacheKey(entry: cacheApi.RemoteCacheEntry): string {
  return `${entry.hash}.${entry.ext}`
}

async function ensureBlobUrl(entry: cacheApi.RemoteCacheEntry): Promise<string> {
  const key = getCacheKey(entry)
  if (blobUrlCache.has(key)) return blobUrlCache.get(key)!
  const url = cacheApi.getRemotePreviewUrl(entry.hash, entry.ext)
  const token = localStorage.getItem('auth_token')
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`加载失败 (${res.status})`)
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  evictOldBlobs()
  blobUrlCache.set(key, blobUrl)
  return blobUrl
}

async function getThumbnailUrl(entry: cacheApi.RemoteCacheEntry): Promise<string> {
  try {
    return await ensureBlobUrl(entry)
  } catch {
    return ''
  }
}

const thumbnailUrls = reactive(new Map<string, string>())

async function loadThumbnail(entry: cacheApi.RemoteCacheEntry) {
  const key = getCacheKey(entry)
  if (thumbnailUrls.has(key)) return
  const url = await getThumbnailUrl(entry)
  if (url) thumbnailUrls.set(key, url)
}

async function openPreview(entry: cacheApi.RemoteCacheEntry) {
  previewEntry.value = entry
  const key = getCacheKey(entry)
  if (blobUrlCache.has(key)) {
    previewBlobUrl.value = blobUrlCache.get(key)!
  } else {
    try {
      previewBlobUrl.value = await ensureBlobUrl(entry)
    } catch {
      previewBlobUrl.value = ''
    }
  }
}

function closePreview() {
  previewEntry.value = null
  previewBlobUrl.value = ''
}

function revokeAllBlobUrls() {
  for (const url of blobUrlCache.values()) URL.revokeObjectURL(url)
  blobUrlCache.clear()
  for (const url of thumbnailUrls.values()) URL.revokeObjectURL(url)
  thumbnailUrls.clear()
  previewBlobUrl.value = ''
}

async function loadCacheStats() {
  cacheStatsLoading.value = true
  cacheStatsError.value = ''
  try {
    cacheStats.value = await cacheApi.getStats()
  } catch (e: unknown) {
    cacheStatsError.value = e instanceof Error ? e.message : '加载缓存统计失败'
  } finally {
    cacheStatsLoading.value = false
  }
}

async function loadExportEntries() {
  cacheEntriesLoading.value = true
  try {
    exportEntries.value = await cacheApi.listExportEntries()
    showExportDetail.value = true
  } catch (e: unknown) {
    cacheStatsError.value = e instanceof Error ? e.message : '加载导出缓存列表失败'
  } finally {
    cacheEntriesLoading.value = false
  }
}

function toggleExportDetail() {
  if (showExportDetail.value) {
    showExportDetail.value = false
  } else {
    loadExportEntries()
  }
}

async function loadRemoteEntries(offset = 0) {
  revokeAllBlobUrls()
  if (!showRemoteDetail.value) {
    showRemoteDetail.value = true
  }
  cacheEntriesLoading.value = true
  try {
    const page = await cacheApi.listRemoteEntries(offset, remotePageSize)
    remoteEntries.value = page.entries
    remoteTotal.value = page.total
    remoteOffset.value = page.offset
    for (const entry of page.entries) {
      if (isImageMime(entry.mimeType) || isVideoMime(entry.mimeType)) {
        loadThumbnail(entry)
      }
    }
  } catch (e: unknown) {
    cacheStatsError.value = e instanceof Error ? e.message : '加载远程缓存列表失败'
  } finally {
    cacheEntriesLoading.value = false
  }
}

function toggleRemoteDetail() {
  if (showRemoteDetail.value) {
    showRemoteDetail.value = false
    revokeAllBlobUrls()
  } else {
    loadRemoteEntries(0)
  }
}

const remoteCurrentPage = computed(() => Math.floor(remoteOffset.value / remotePageSize) + 1)
const remoteTotalPages = computed(() => Math.max(1, Math.ceil(remoteTotal.value / remotePageSize)))

function remoteGoPage(page: number) {
  const offset = (page - 1) * remotePageSize
  if (offset < 0 || offset >= remoteTotal.value) return
  loadRemoteEntries(offset)
}

async function handleDeleteRemoteEntry(entry: cacheApi.RemoteCacheEntry) {
  if (!await dangerConfirm(`确定删除此远程缓存？\n\n${shortUrl(entry.url, 80)}\n${formatSize(entry.size)} · ${entry.mimeType}`)) return
  try {
    await cacheApi.deleteRemoteEntry(entry.hash, entry.ext)
    const key = getCacheKey(entry)
    if (blobUrlCache.has(key)) {
      URL.revokeObjectURL(blobUrlCache.get(key)!)
      blobUrlCache.delete(key)
    }
    if (thumbnailUrls.has(key)) {
      URL.revokeObjectURL(thumbnailUrls.get(key)!)
      thumbnailUrls.delete(key)
    }
    cacheCleanResult.value = `已删除: ${shortUrl(entry.url, 50)}`
    await loadRemoteEntries(remoteOffset.value)
    await loadCacheStats()
  } catch (e: unknown) {
    cacheStatsError.value = e instanceof Error ? e.message : '删除失败'
  }
}

async function handleCleanCache() {
  if (!await dangerConfirm('确定清理所有过期的缓存文件？')) return
  cacheCleaning.value = true
  cacheCleanResult.value = ''
  try {
    const r = await cacheApi.cleanExpired()
    cacheCleanResult.value = `已清理远程缓存 ${r.remoteCleaned} 条，导出缓存 ${r.exportCleaned} 条`
    await loadCacheStats()
  } catch (e: unknown) {
    cacheStatsError.value = e instanceof Error ? e.message : '清理缓存失败'
  } finally {
    cacheCleaning.value = false
  }
}

async function handleDeleteExportEntry(entry: cacheApi.ExportCacheEntry) {
  if (!await dangerConfirm(`确定删除此缓存文件？\n\n${entry.fileName}\n${formatSize(entry.fileSize)} · ${entry.catalogTitle}`)) return
  try {
    await cacheApi.deleteExportEntry(entry.id)
    exportEntries.value = exportEntries.value.filter(e => e.id !== entry.id)
    cacheCleanResult.value = `已删除: ${entry.fileName}`
    await loadCacheStats()
  } catch (e: unknown) {
    cacheStatsError.value = e instanceof Error ? e.message : '删除失败'
  }
}

async function handleDownloadExportEntry(entry: cacheApi.ExportCacheEntry) {
  try {
    await cacheApi.downloadExportEntry(entry.id, entry.fileName)
  } catch (e: unknown) {
    cacheStatsError.value = e instanceof Error ? e.message : '下载失败'
  }
}

async function handleClearAllRemote() {
  if (!await dangerConfirm('确定清除全部远程资源缓存？图片/视频等远程资源下次导出时需重新下载。')) return
  cacheCleaning.value = true
  try {
    const r = await cacheApi.clearAllRemote()
    revokeAllBlobUrls()
    remoteEntries.value = []
    remoteTotal.value = 0
    remoteOffset.value = 0
    cacheCleanResult.value = `已清除远程缓存 ${r.deleted} 条`
    await loadCacheStats()
  } catch (e: unknown) {
    cacheStatsError.value = e instanceof Error ? e.message : '清除远程缓存失败'
  } finally {
    cacheCleaning.value = false
  }
}

function typeLabel(t: string): string {
  return t === 'markdown' ? 'MD ZIP' : t === 'pdf' ? 'PDF' : t
}

function timeLabelShort(dt: string): string {
  return new Date(dt + 'Z').toLocaleString()
}

function shortUrl(url: string, max = 60): string {
  return url.length > max ? url.slice(0, max) + '…' : url
}

onMounted(() => {
  loadUsers()
  loadProjects()
  if (activeTab.value === 'storage') {
    loadCacheStats()
  }
})

watch(activeTab, (tab) => {
  router.replace({ query: { tab } })
  if (tab === 'storage' && !cacheStats.value) {
    loadCacheStats()
  }
})

onBeforeUnmount(() => {
  revokeAllBlobUrls()
})
</script>

<template>
  <div v-if="!isAdmin" class="p-8 text-center text-gray-500">
    你没有系统管理员权限
  </div>

  <div v-else class="flex h-full">
    <SettingsSidebar
      title="系统设置"
      :tabs="settingsTabs"
      v-model="activeTab"
    />

    <main class="flex-1 overflow-auto p-6">
      <!-- 项目管理 -->
      <div v-if="activeTab === 'projects'">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold">项目管理</h2>
          <button class="btn-primary text-sm" @click="showAddProject = true">
            <span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />新建项目
          </button>
        </div>

        <div class="card">
          <div v-if="projects.length === 0" class="text-sm text-gray-400 py-4 text-center">暂无项目</div>
          <div v-for="p in projects" :key="p.id" class="flex items-center gap-3 py-3 border-t border-gray-100 first:border-t-0">
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">
                {{ p.name }}
                <span v-if="p.id === 'default'" class="inline-block text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded ml-1 align-middle">默认</span>
              </div>
              <div class="text-xs text-gray-400 truncate">{{ p.description || '无描述' }}</div>
            </div>
            <button class="text-blue-400 hover:text-blue-600 text-sm" @click="openEditProject(p)">编辑</button>
            <button
              v-if="p.id !== 'default'"
              class="text-red-400 hover:text-red-600 text-sm"
              v-tooltip="'删除'"
              @click="deleteProject(p.id)"
            ><span class="i-lucide-x w-4 h-4 inline-block align-middle" /></button>
            <span v-else class="text-xs text-gray-300 cursor-not-allowed select-none" v-tooltip="'不能删除默认项目'">—</span>
          </div>
        </div>
      </div>

      <!-- 账号管理 -->
      <div v-if="activeTab === 'users'">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold">账号管理</h2>
          <button class="btn-primary text-sm" @click="showAddUser = true">
            <span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />添加账号
          </button>
        </div>

        <div class="card">
          <div v-if="localUsers.length === 0" class="text-sm text-gray-400 py-4 text-center">暂无账号</div>
          <div v-for="u in localUsers" :key="u.id" class="flex items-center gap-3 py-3 border-t border-gray-100 first:border-t-0">
            <UserAvatar :avatar-url="u.feishuAvatarUrl" :name="u.feishuName || u.displayName || u.username" size="md" />
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">{{ u.feishuName || u.displayName }}</div>
              <div class="text-xs text-gray-400 truncate">{{ u.username }} · {{ roleLabel(u.role) }}</div>
            </div>
            <SelectDropdown
              width-class="w-32"
              :model-value="u.role"
              :options="roleOptions"
              @update:model-value="(val: string | number | null) => changeUserRole(u.id, val as string)"
            />
            <button class="text-red-400 hover:text-red-600 text-sm flex-shrink-0" @click="deleteUser(u.id)">删除</button>
          </div>
        </div>
      </div>

      <!-- 备份恢复 -->
      <div v-if="activeTab === 'backup'">
        <div class="mb-4">
          <h2 class="text-lg font-semibold">备份恢复</h2>
          <p class="text-xs text-gray-400 mt-0.5">导出完整数据库文件，用于系统迁移或灾难恢复。</p>
        </div>

        <div class="card">
          <ErrorMessage :message="backupError" />
          <div class="flex items-center gap-3">
            <button class="btn-primary text-sm" :disabled="backupRunning" @click="startSystemBackup">
              <span class="i-lucide-database w-4 h-4 inline-block align-middle mr-1" />{{ backupRunning ? '备份中...' : '完整备份' }}
            </button>
            <a v-if="backupLink" :href="backupLink" class="text-blue-500 hover:underline text-sm">下载备份</a>
          </div>
        </div>
      </div>

      <!-- 存储与缓存 -->
      <div v-if="activeTab === 'storage'">
        <div class="mb-4">
          <h2 class="text-lg font-semibold">存储与缓存</h2>
          <p class="text-xs text-gray-400 mt-0.5">管理孤立文件和导出缓存，释放磁盘空间。</p>
        </div>

        <!-- 存储清理 -->
        <div class="card mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-500">存储清理</h3>
            <div class="flex gap-2">
              <button class="btn-secondary text-sm" :disabled="orphansLoading" @click="loadOrphans">
                {{ orphansLoading ? '扫描中...' : '扫描孤立文件' }}
              </button>
              <button
                v-if="orphans.length > 0"
                class="btn-danger text-sm"
                @click="handleCleanOrphans"
              >清理 {{ orphans.length }} 个文件 ({{ formatSize(orphansTotalSize) }})</button>
            </div>
          </div>
          <p class="text-xs text-gray-400 mb-3">扫描并清理未被任何文档引用的上传文件。</p>
          <ErrorMessage :message="orphansError" />
          <div v-if="cleanResult" class="text-xs text-green-600">已删除 {{ cleanResult.deleted }} 个文件</div>
          <div v-if="orphans.length > 0" class="text-xs text-gray-400 max-h-32 overflow-y-auto space-y-0.5">
            <div v-for="f in orphans" :key="f.path">{{ f.path }} ({{ formatSize(f.size) }})</div>
          </div>
        </div>

        <!-- 上传资源 -->
        <div class="card mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-500">上传资源</h3>
            <div class="flex gap-2">
              <button class="btn-secondary text-sm" :disabled="uploadFilesLoading" @click="toggleUploadFiles">
                {{ uploadFilesLoading ? '加载中...' : showUploadFiles ? '收起' : '查看上传资源' }}
              </button>
              <button
                v-if="uploadFilesOrphanedCount > 0"
                class="btn-danger text-sm"
                @click="handleCleanAllOrphans"
              >清理 {{ uploadFilesOrphanedCount }} 个未引用</button>
            </div>
          </div>
          <p class="text-xs text-gray-400 mb-3">管理所有上传的图片和视频文件，查看引用状态。</p>
          <ErrorMessage :message="uploadFilesError" />
          <div v-if="uploadFilesResult" class="text-xs text-green-600 mb-3">{{ uploadFilesResult }}</div>

          <div v-if="showUploadFiles">
            <!-- 统计概览 -->
            <div v-if="uploadFilesTotalCount > 0" class="flex items-center gap-4 mb-3 text-xs text-gray-500">
              <span>共 <strong>{{ uploadFilesTotalCount }}</strong> 个文件</span>
              <span>{{ formatSize(uploadFilesTotalSize) }}</span>
              <span class="text-green-600">{{ uploadFilesReferencedCount }} 个已引用</span>
              <span v-if="uploadFilesOrphanedCount > 0" class="text-red-400">{{ uploadFilesOrphanedCount }} 个未引用</span>
            </div>
            <div v-else-if="!uploadFilesLoading" class="text-xs text-gray-400 py-4 text-center">暂无上传文件</div>

            <!-- 文件列表 -->
            <div v-if="uploadFiles.length > 0" class="border-t border-gray-100 pt-3 max-h-[500px] overflow-y-auto">
              <table class="w-full text-xs">
                <thead class="text-left text-gray-400 border-b border-gray-100 sticky top-0 bg-white">
                  <tr>
                    <th class="py-1.5 pr-2 font-medium w-6"></th>
                    <th class="py-1.5 pr-2 font-medium">路径</th>
                    <th class="py-1.5 pr-2 font-medium w-16 text-right">大小</th>
                    <th class="py-1.5 pr-2 font-medium w-14 text-center">状态</th>
                    <th class="py-1.5 pr-2 font-medium w-36">时间</th>
                    <th class="py-1.5 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="file in uploadFiles"
                    :key="file.path"
                    class="border-b border-gray-50 hover:bg-gray-50"
                    :class="{ 'cursor-pointer': isImagePath(file.path) || isVideoPath(file.path) }"
                    @click="openUploadPreview(file)"
                  >
                    <td class="py-1.5 pr-2">
                      <span v-if="isImagePath(file.path)" class="i-lucide-image w-4 h-4 inline-block align-middle text-blue-400" />
                      <span v-else-if="isVideoPath(file.path)" class="i-lucide-video w-4 h-4 inline-block align-middle text-purple-400" />
                      <span v-else class="i-lucide-file w-4 h-4 inline-block align-middle text-gray-400" />
                    </td>
                    <td class="py-1.5 pr-2 truncate max-w-[240px]" v-tooltip="file.path">
                      <span v-if="isImagePath(file.path) || isVideoPath(file.path)" class="text-blue-500 hover:underline">{{ file.path }}</span>
                      <template v-else>{{ file.path }}</template>
                    </td>
                    <td class="py-1.5 pr-2 text-right text-gray-500">{{ formatSize(file.size) }}</td>
                    <td class="py-1.5 pr-2 text-center">
                      <span v-if="file.referenced" class="text-green-600">已引用</span>
                      <span v-else class="text-red-400">未引用</span>
                    </td>
                    <td class="py-1.5 pr-2 text-gray-400">{{ new Date(file.mtime).toLocaleString() }}</td>
                    <td class="py-1.5">
                      <button class="text-red-400 hover:text-red-600" v-tooltip="'删除此文件'" @click.stop="handleDeleteUploadFile(file)">
                        <span class="i-lucide-trash-2 w-3.5 h-3.5 inline-block align-middle" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 缓存管理 -->
        <div class="card">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-500">缓存管理</h3>
            <div class="flex gap-2">
              <button class="btn-danger text-sm" :disabled="cacheCleaning" @click="handleCleanCache">
                <span class="i-lucide-trash-2 w-4 h-4 inline-block align-middle mr-1" />{{ cacheCleaning ? '清理中...' : '清理过期' }}
              </button>
            </div>
          </div>
          <p class="text-xs text-gray-400 mb-3">查看和清理导出的 Markdown ZIP、PDF 文件缓存以及远程资源缓存。</p>
          <ErrorMessage :message="cacheStatsError" />

          <div v-if="cacheStatsLoading" class="flex items-center gap-2 text-xs text-gray-400 mb-3">
            <span class="i-lucide-loader-2 w-4 h-4 animate-spin" />加载统计中...
          </div>
          <div v-else-if="cacheStats" class="text-xs text-gray-500 space-y-1 mb-3">
            <div class="flex items-center gap-2">
              <span class="i-lucide-hard-drive w-3.5 h-3.5 inline-block align-middle text-gray-400" />
              <span>远程资源（图片/视频）：{{ cacheStats.remote.count }} 个 · {{ formatSize(cacheStats.remote.totalSize) }}</span>
              <button v-if="cacheStats.remote.count > 0" class="text-blue-400 hover:text-blue-600 ml-1" :disabled="cacheEntriesLoading" @click="toggleRemoteDetail">
                {{ showRemoteDetail ? '收起' : '查看' }}
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span class="i-lucide-file-archive w-3.5 h-3.5 inline-block align-middle text-gray-400" />
              <span>导出产物（MD ZIP / PDF）：{{ cacheStats.export.count }} 个 · {{ formatSize(cacheStats.export.totalSize) }}</span>
              <button v-if="cacheStats.export.count > 0" class="text-blue-400 hover:text-blue-600 ml-1" :disabled="cacheEntriesLoading" @click="toggleExportDetail">
                {{ showExportDetail ? '收起' : '查看' }}
              </button>
            </div>
            <p class="text-gray-400">远程 7 天 · 导出 30 天自动过期</p>
          </div>

          <div v-if="cacheCleanResult" class="text-xs text-green-600 mb-3">{{ cacheCleanResult }}</div>

          <!-- 导出缓存：紧凑表格 -->
          <div v-if="showExportDetail" class="border-t border-gray-100 pt-3 mb-3">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-sm font-medium">导出缓存文件</h4>
              <button class="text-xs text-blue-400 hover:text-blue-600" :disabled="cacheEntriesLoading" @click="loadExportEntries">
                {{ cacheEntriesLoading ? '加载中...' : '刷新' }}
              </button>
            </div>
            <div v-if="exportEntries.length === 0" class="text-xs text-gray-400 py-4 text-center">暂无导出缓存文件</div>
            <table v-else class="w-full text-xs">
              <thead>
                <tr class="text-left text-gray-400 border-b border-gray-100">
                  <th class="py-1.5 pr-2 font-medium w-6"></th>
                  <th class="py-1.5 pr-2 font-medium">文件名</th>
                  <th class="py-1.5 pr-2 font-medium">章节</th>
                  <th class="py-1.5 pr-2 font-medium w-14">类型</th>
                  <th class="py-1.5 pr-2 font-medium w-16 text-right">大小</th>
                  <th class="py-1.5 pr-2 font-medium w-36">时间</th>
                  <th class="py-1.5 font-medium w-12"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in exportEntries" :key="entry.id" class="border-b border-gray-50 hover:bg-gray-50">
                  <td class="py-1.5 pr-2">
                    <span :class="entry.type === 'pdf' ? 'i-lucide-file-text' : 'i-lucide-file-archive'" class="w-4 h-4 inline-block align-middle" :style="{ color: entry.type === 'pdf' ? '#ef4444' : '#f59e0b' }" />
                  </td>
                  <td class="py-1.5 pr-2 truncate max-w-[200px]" v-tooltip="entry.fileName">{{ entry.fileName }}</td>
                  <td class="py-1.5 pr-2 truncate max-w-[160px] text-gray-500" v-tooltip="entry.catalogTitle">{{ entry.catalogTitle }}</td>
                  <td class="py-1.5 pr-2 text-gray-500">{{ typeLabel(entry.type) }}</td>
                  <td class="py-1.5 pr-2 text-right text-gray-500">{{ formatSize(entry.fileSize) }}</td>
                  <td class="py-1.5 pr-2 text-gray-400">{{ timeLabelShort(entry.createdAt) }}</td>
                  <td class="py-1.5">
                    <div class="flex items-center gap-1">
                      <button class="text-blue-400 hover:text-blue-600" v-tooltip="'下载此文件'" @click="handleDownloadExportEntry(entry)">
                        <span class="i-lucide-download w-3.5 h-3.5 inline-block align-middle" />
                      </button>
                      <button class="text-red-400 hover:text-red-600" v-tooltip="'删除此缓存'" @click="handleDeleteExportEntry(entry)">
                        <span class="i-lucide-trash-2 w-3.5 h-3.5 inline-block align-middle" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 远程缓存：网格缩略图 -->
          <div v-if="showRemoteDetail" class="border-t border-gray-100 pt-3">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-sm font-medium">远程资源缓存 <span class="text-gray-400 font-normal">({{ remoteTotal }} 条)</span></h4>
              <div class="flex gap-2">
                <button class="text-xs text-blue-400 hover:text-blue-600" :disabled="cacheEntriesLoading" @click="loadRemoteEntries(remoteOffset)">
                  {{ cacheEntriesLoading ? '加载中...' : '刷新' }}
                </button>
                <button
                  v-if="cacheStats && cacheStats.remote.count > 0"
                  class="text-xs text-red-400 hover:text-red-600"
                  :disabled="cacheCleaning"
                  @click="handleClearAllRemote"
                >全部清除</button>
              </div>
            </div>
            <div v-if="cacheEntriesLoading && remoteEntries.length === 0" class="flex items-center justify-center py-8 text-gray-400 text-xs">
              <span class="i-lucide-loader-2 w-5 h-5 animate-spin mr-2" />加载中...
            </div>
            <div v-else-if="remoteEntries.length === 0" class="text-xs text-gray-400 py-4 text-center">暂无远程缓存</div>
            <template v-else>
              <div class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                <div
                  v-for="entry in remoteEntries"
                  :key="`${entry.url}-${entry.hash}`"
                  class="group relative rounded-lg border border-gray-200 overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all"
                  @click="openPreview(entry)"
                >
                  <div class="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                    <template v-if="isImageMime(entry.mimeType) || isVideoMime(entry.mimeType)">
                      <img
                        v-if="isImageMime(entry.mimeType) && thumbnailUrls.get(getCacheKey(entry))"
                        :src="thumbnailUrls.get(getCacheKey(entry))"
                        :alt="shortUrl(entry.url, 30)"
                        class="w-full h-full object-cover"
                      />
                      <video
                        v-else-if="isVideoMime(entry.mimeType) && thumbnailUrls.get(getCacheKey(entry))"
                        :src="thumbnailUrls.get(getCacheKey(entry))"
                        class="w-full h-full object-cover"
                        muted
                        preload="metadata"
                      />
                      <div v-else class="flex items-center justify-center">
                        <span class="i-lucide-loader-2 w-6 h-6 text-gray-300 animate-spin" />
                      </div>
                    </template>
                    <div v-else class="flex flex-col items-center gap-1 text-gray-400">
                      <span class="i-lucide-file w-8 h-8" />
                      <span class="text-[10px]">{{ entry.ext.replace('.', '').toUpperCase() }}</span>
                    </div>
                  </div>
                  <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div class="text-[10px] text-white truncate" v-tooltip="entry.url">{{ shortUrl(entry.url, 25) }}</div>
                    <div class="text-[10px] text-white/70">{{ formatSize(entry.size) }} · {{ entry.fetchCount }}次</div>
                  </div>
                  <button
                    class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/40 text-white/80 hover:bg-red-500 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    v-tooltip="'删除此缓存'"
                    @click.stop="handleDeleteRemoteEntry(entry)"
                  >
                    <span class="i-lucide-x w-3 h-3 inline-block align-middle" />
                  </button>
                </div>
              </div>
              <!-- 分页 -->
              <Paginator
                :current="remoteCurrentPage"
                :total="remoteTotalPages"
                @go="remoteGoPage"
              />
            </template>
          </div>
        </div>
      </div>

      <!-- 操作日志 -->
      <div v-if="activeTab === 'audit'" class="card">
        <div class="mb-4">
          <h2 class="text-lg font-semibold">操作日志</h2>
          <p class="text-xs text-gray-400 mt-0.5">记录系统中敏感操作的审计信息，仅管理员可见。</p>
        </div>
        <AuditLog />
      </div>
    </main>
  </div>

  <!-- 新建项目 -->
  <ModalDialog
    :visible="showAddProject"
    title="新建项目"
    confirm-text="创建"
    cancel-text="取消"
    :error="projectError"
    @close="showAddProject = false"
    @confirm="createProject"
  >
    <div class="space-y-4">
      <FormField label="项目名称" :required="true">
        <input v-model="newProject.name" class="input" placeholder="如：水域监管系统" />
      </FormField>
      <FormField label="项目描述">
        <textarea v-model="newProject.description" class="textarea" rows="2" placeholder="简要描述项目用途" />
      </FormField>
    </div>
  </ModalDialog>

  <!-- 编辑项目 -->
  <ModalDialog
    :visible="editingProject !== null"
    title="编辑项目"
    confirm-text="保存"
    cancel-text="取消"
    :error="projectError"
    @close="editingProject = null"
    @confirm="saveEditProject"
  >
    <div class="space-y-4">
      <FormField label="项目名称" :required="true">
        <input v-model="editProjectForm.name" class="input" placeholder="如：水域监管系统" />
      </FormField>
      <FormField label="项目描述">
        <textarea v-model="editProjectForm.description" class="textarea" rows="2" placeholder="简要描述项目用途" />
      </FormField>
    </div>
  </ModalDialog>

  <!-- 添加用户 -->
  <ModalDialog
    :visible="showAddUser"
    title="添加本地账号"
    confirm-text="添加"
    cancel-text="取消"
    :error="addUserError"
    @close="showAddUser = false"
    @confirm="addUser"
  >
    <div class="space-y-4">
      <FormField label="用户名" :required="true">
        <input v-model="newUser.username" class="input" placeholder="登录用户名" />
      </FormField>
      <FormField label="显示名称">
        <input v-model="newUser.displayName" class="input" placeholder="显示在页面上的名称" />
      </FormField>
      <FormField label="密码" :required="true">
        <PasswordInput v-model="newUser.password" placeholder="至少8位，含大小写字母、数字、特殊字符中至少3种" />
      </FormField>
      <FormField label="角色">
        <SelectDropdown v-model="newUser.role" :options="roleOptions" />
      </FormField>
    </div>
  </ModalDialog>

  <!-- 远程缓存预览弹窗 -->
  <Teleport to="body">
    <div
      v-if="previewEntry"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="closePreview"
    >
      <div class="relative bg-white rounded-xl shadow-2xl max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" @click.stop>
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div class="text-sm font-medium truncate mr-4">{{ previewEntry.mimeType }} · {{ formatSize(previewEntry.size) }}</div>
          <button class="text-gray-400 hover:text-gray-600" @click="closePreview">
            <span class="i-lucide-x w-5 h-5 inline-block align-middle" />
          </button>
        </div>
        <div class="flex-1 overflow-auto flex items-center justify-center p-4 bg-gray-50 min-h-0">
          <img
            v-if="isImageMime(previewEntry.mimeType) && previewBlobUrl"
            :src="previewBlobUrl"
            class="max-w-full max-h-[70vh] object-contain rounded"
            alt=""
          />
          <video
            v-else-if="isVideoMime(previewEntry.mimeType) && previewBlobUrl"
            :src="previewBlobUrl"
            class="max-w-full max-h-[70vh] rounded"
            controls
          />
          <div v-else-if="!previewBlobUrl" class="flex items-center gap-2 text-gray-400">
            <span class="i-lucide-loader-2 w-5 h-5 animate-spin" />加载中...
          </div>
          <div v-else class="text-sm text-gray-400">此类型文件不支持预览</div>
        </div>
        <div class="px-4 py-2.5 border-t border-gray-100 text-xs text-gray-400 space-y-0.5 bg-white">
          <div class="truncate" v-tooltip="previewEntry.url">
            <span class="text-gray-500 font-medium">URL：</span>{{ previewEntry.url }}
          </div>
          <div>
            <span class="text-gray-500 font-medium">访问：</span>{{ previewEntry.fetchCount }} 次 ·
            <span class="text-gray-500 font-medium">最后访问：</span>{{ timeLabelShort(previewEntry.accessedAt) }} ·
            <span class="text-gray-500 font-medium">缓存时间：</span>{{ timeLabelShort(previewEntry.createdAt) }}
          </div>
        </div>
      </div>

    </div>
  </Teleport>

  <!-- 上传资源预览弹窗 -->
  <Teleport to="body">
    <div
      v-if="uploadPreviewFile"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="closeUploadPreview"
    >
      <div class="relative bg-white rounded-xl shadow-2xl max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" @click.stop>
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div class="text-sm font-medium truncate mr-4">{{ uploadPreviewFile.path }} · {{ formatSize(uploadPreviewFile.size) }}</div>
          <button class="text-gray-400 hover:text-gray-600" @click="closeUploadPreview">
            <span class="i-lucide-x w-5 h-5 inline-block align-middle" />
          </button>
        </div>
        <div class="flex-1 overflow-auto flex items-center justify-center p-4 bg-gray-50 min-h-0">
          <img
            v-if="isImagePath(uploadPreviewFile.path)"
            :src="getUploadPreviewUrl(uploadPreviewFile)"
            class="max-w-full max-h-[70vh] object-contain rounded"
            alt=""
          />
          <video
            v-else-if="isVideoPath(uploadPreviewFile.path)"
            :src="getUploadPreviewUrl(uploadPreviewFile)"
            class="max-w-full max-h-[70vh] rounded"
            controls
          />
          <div v-else class="text-sm text-gray-400">此类型文件不支持预览</div>
        </div>
        <div class="px-4 py-2.5 border-t border-gray-100 text-xs text-gray-400 bg-white">
          <div>
            <span class="text-gray-500 font-medium">路径：</span>{{ uploadPreviewFile.path }}
          </div>
          <div>
            <span class="text-gray-500 font-medium">大小：</span>{{ formatSize(uploadPreviewFile.size) }} ·
            <span class="text-gray-500 font-medium">修改时间：</span>{{ new Date(uploadPreviewFile.mtime).toLocaleString() }} ·
            <span :class="uploadPreviewFile.referenced ? 'text-green-600' : 'text-red-400'">
              {{ uploadPreviewFile.referenced ? '已引用' : '未引用' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>