<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import * as dataApi from '@/api/endpoints/data-tasks'
import type {
  ExportEstimate, ImportDiffReport, ImportApplyOptions, DataTaskInfo,
} from '@shared/types'

const { canManageProject } = useAuth()
const { currentProjectId } = useProject()

// ---- 导出预估 ----
const estimate = ref<ExportEstimate | null>(null)
const estimateLoading = ref(false)

async function loadEstimate() {
  if (!currentProjectId.value) return
  estimateLoading.value = true
  try {
    estimate.value = await dataApi.getExportEstimate(currentProjectId.value)
  } catch { estimate.value = null }
  finally { estimateLoading.value = false }
}

watch(currentProjectId, loadEstimate)

// ---- 导出任务 ----
const exporting = ref(false)
const exportTaskId = ref<string | null>(null)
const exportProgress = ref(0)
const exportLabel = ref('')
const exportHistory = ref<DataTaskInfo[]>([])

let exportPollTimer: ReturnType<typeof setInterval> | null = null

async function loadExportHistory() {
  if (!currentProjectId.value) return
  try {
    const tasks = await dataApi.listTasks(`project:${currentProjectId.value}`)
    exportHistory.value = tasks.filter(t => t.type === 'export')
  } catch { /* ignore */ }
}

async function startExport() {
  if (!currentProjectId.value) return
  exporting.value = true
  try {
    const { taskId } = await dataApi.startExport(currentProjectId.value)
    exportTaskId.value = taskId
    pollExportTask()
  } catch { exporting.value = false }
}

function pollExportTask() {
  if (!exportTaskId.value) return
  exportPollTimer = setInterval(async () => {
    try {
      const task = await dataApi.getTask(exportTaskId.value!)
      exportProgress.value = task.progress
      exportLabel.value = task.progressLabel || ''
      if (task.status === 'completed') {
        stopPolling()
        exporting.value = false
        exportTaskId.value = null
        await dataApi.downloadExport(task.id)
        await loadExportHistory()
      } else if (task.status === 'failed') {
        stopPolling()
        exporting.value = false
        exportTaskId.value = null
        alert(`导出失败: ${task.errorMessage}`)
        await loadExportHistory()
      }
    } catch { stopPolling(); exporting.value = false }
  }, 1000)
}

function stopPolling() {
  if (exportPollTimer) { clearInterval(exportPollTimer); exportPollTimer = null }
}

async function downloadTaskFile(taskId: string) {
  try {
    await dataApi.downloadExport(taskId)
  } catch { /* ignore */ }
}

async function removeTask(taskId: string) {
  try {
    await dataApi.deleteTask(taskId)
    await loadExportHistory()
    await loadImportHistory()
  } catch { /* ignore */ }
}

// ---- 导入 ----
const importFileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const importTaskId = ref<string | null>(null)
const importDiff = ref<ImportDiffReport | null>(null)
const importHistory = ref<DataTaskInfo[]>([])

// 用户选择的冲突策略
const strategies = ref<ImportApplyOptions['strategies']>({
  categories: {},
  features: {},
  catalogs: {},
  documents: {},
})

async function loadImportHistory() {
  if (!currentProjectId.value) return
  try {
    const tasks = await dataApi.listTasks(`project:${currentProjectId.value}`)
    importHistory.value = tasks.filter(t => t.type === 'import')
  } catch { /* ignore */ }
}

function triggerFileSelect() {
  importFileInput.value?.click()
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !currentProjectId.value) return

  if (!file.name.endsWith('.zip')) {
    alert('请选择 .zip 文件')
    return
  }

  importing.value = true
  importDiff.value = null

  try {
    const { taskId } = await dataApi.uploadImport(currentProjectId.value, file)
    importTaskId.value = taskId
    const diff = await dataApi.analyzeImport(taskId)
    importDiff.value = diff
    // 默认：新增的全导入，冲突的 skip
    initDefaultStrategies(diff)
  } catch (e: unknown) {
    alert(`导入失败: ${e instanceof Error ? e.message : '未知错误'}`)
    importing.value = false
  }
  // 重置 file input
  input.value = ''
}

function initDefaultStrategies(diff: ImportDiffReport) {
  strategies.value = { categories: {}, features: {}, catalogs: {}, documents: {} }
  // 新增的不需要策略（直接导入）
  // 冲突的默认 skip
  for (const c of diff.categories.conflicted) { strategies.value.categories[c.id] = 'skip' }
  for (const f of diff.features.conflicted) { strategies.value.features[f.id] = 'skip' }
  for (const c of diff.catalogs.conflicted) { strategies.value.catalogs[c.id] = 'skip' }
  // 文档冲突
  for (let i = 0; i < diff.documents.conflicted; i++) { /* 需要具体 docId，但 diff 只返回数字，实际 apply 时处理 */ }
}

function toggleStrategy(
  target: 'categories' | 'features' | 'catalogs',
  id: string,
) {
  const current = strategies.value[target][id]
  strategies.value[target][id] = current === 'overwrite' ? 'skip' : 'overwrite'
}

function strategyLabel(s: string | undefined): string {
  return s === 'overwrite' ? '覆盖' : '跳过'
}

async function confirmImport() {
  if (!importTaskId.value || !importDiff.value) return
  try {
    const result = await dataApi.applyImport(importTaskId.value, {
      strategies: strategies.value,
      includeMembers: true,
    })
    const msg = [
      `功能: 新增${result.features.inserted} 更新${result.features.updated} 跳过${result.features.skipped}`,
      `目录: 新增${result.catalogs.inserted} 更新${result.catalogs.updated}`,
      `文档: 新增${result.documents.inserted} 更新${result.documents.updated}`,
      `成员: ${result.members.inserted}`,
      `文件: 复制${result.uploads.copied} 跳过${result.uploads.skipped}`,
    ].join('\n')
    alert(`导入完成!\n${msg}`)
    importing.value = false
    importTaskId.value = null
    importDiff.value = null
    await loadImportHistory()
  } catch (e: unknown) {
    alert(`导入失败: ${e instanceof Error ? e.message : '未知错误'}`)
  }
}

function cancelImport() {
  importing.value = false
  importTaskId.value = null
  importDiff.value = null
}

// ---- 孤儿文件 ----
const orphans = ref<{ path: string; size: number; mtime: string }[]>([])
const orphansTotalSize = ref(0)
const orphansLoading = ref(false)
const clearingOrphans = ref(false)

async function loadOrphans() {
  orphansLoading.value = true
  try {
    const data = await dataApi.getOrphans()
    orphans.value = data.orphans
    orphansTotalSize.value = data.totalSize
  } catch { orphans.value = []; orphansTotalSize.value = 0 }
  finally { orphansLoading.value = false }
}

async function clearOrphans() {
  if (orphans.value.length === 0) return
  if (!confirm(`确定删除 ${orphans.value.length} 个未引用文件？\n释放空间: ${formatSize(orphansTotalSize.value)}`)) return
  clearingOrphans.value = true
  try {
    await dataApi.deleteOrphans()
    await loadOrphans()
  } catch { /* ignore */ }
  finally { clearingOrphans.value = false }
}

// ---- 系统备份 ----
const systemExporting = ref(false)

async function startSystemExport() {
  systemExporting.value = true
  try {
    const { taskId } = await dataApi.startSystemExport()
    // 简单轮询
    const timer = setInterval(async () => {
      const task = await dataApi.getTask(taskId)
      if (task.status === 'completed') {
        clearInterval(timer)
        systemExporting.value = false
        await dataApi.downloadExport(taskId)
      } else if (task.status === 'failed') {
        clearInterval(timer)
        systemExporting.value = false
        alert(`备份失败: ${task.errorMessage}`)
      }
    }, 1000)
  } catch { systemExporting.value = false }
}

// ---- 工具 ----
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function statusLabel(s: string): string {
  const labels: Record<string, string> = {
    pending: '等待中', processing: '处理中', uploaded: '已上传',
    analyzed: '已分析', applying: '应用中', completed: '已完成', failed: '失败',
  }
  return labels[s] || s
}

function timeLabel(dt: string | null): string {
  if (!dt) return '-'
  return new Date(dt + 'Z').toLocaleString()
}

onMounted(() => {
  loadEstimate()
  loadOrphans()
  loadExportHistory()
  loadImportHistory()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div v-if="canManageProject" class="card mb-6">
    <h2 class="text-sm font-semibold text-gray-500 mb-4">数据管理</h2>

    <!-- 系统备份 -->
    <div class="border-t border-gray-100 pt-4 mb-4">
      <h3 class="text-sm font-medium mb-2">系统备份</h3>
      <p class="text-xs text-gray-400 mb-2">导出完整数据库文件，用于整实例灾难恢复。</p>
      <button
        class="btn-secondary text-sm"
        :disabled="systemExporting"
        @click="startSystemExport"
      >
        {{ systemExporting ? '正在备份...' : '导出完整数据库' }}
      </button>
    </div>

    <!-- 项目导出 -->
    <div class="border-t border-gray-100 pt-4 mb-4">
      <h3 class="text-sm font-medium mb-2">项目导出</h3>
      <div v-if="estimate" class="text-xs text-gray-400 mb-2">
        预估: {{ estimate.features }} 功能 ·
        {{ estimate.catalogs }} 目录 ·
        {{ estimate.documents }} 文档 ·
        {{ estimate.uploads }} 附件 ·
        约 {{ formatSize(estimate.totalSize) }}
      </div>
      <button
        class="btn-primary text-sm"
        :disabled="exporting || !estimate"
        @click="startExport"
      >
        {{ exporting ? `导出中 ${exportProgress}%...` : '导出此项目' }}
      </button>
      <span v-if="exportLabel" class="text-xs text-gray-400 ml-2">{{ exportLabel }}</span>

      <!-- 导出历史 -->
      <div v-if="exportHistory.length > 0" class="mt-3">
        <h4 class="text-xs font-medium text-gray-400 mb-1">导出历史</h4>
        <div v-for="t in exportHistory" :key="t.id" class="flex items-center gap-2 py-1 text-xs">
          <span :class="t.status === 'completed' ? 'text-green-500' : t.status === 'failed' ? 'text-red-400' : 'text-yellow-500'">
            {{ statusLabel(t.status) }}
          </span>
          <span class="text-gray-400">{{ timeLabel(t.completedAt || t.createdAt) }}</span>
          <span v-if="t.fileSize" class="text-gray-400">{{ formatSize(t.fileSize) }}</span>
          <button
            v-if="t.status === 'completed'"
            class="text-blue-400 hover:text-blue-600 ml-auto"
            @click="downloadTaskFile(t.id)"
          >下载</button>
          <button
            class="text-red-300 hover:text-red-500 ml-1"
            @click="removeTask(t.id)"
          >删</button>
        </div>
      </div>
    </div>

    <!-- 项目导入 -->
    <div class="border-t border-gray-100 pt-4 mb-4">
      <h3 class="text-sm font-medium mb-2">项目导入</h3>
      <p class="text-xs text-gray-400 mb-2">上传项目导出 ZIP，预览差异后确认导入。</p>

      <input
        ref="importFileInput"
        type="file"
        accept=".zip"
        class="hidden"
        @change="onFileSelected"
      />

      <button
        class="btn-secondary text-sm"
        :disabled="importing"
        @click="triggerFileSelect"
      >
        {{ importing ? '正在分析...' : '选择 ZIP 文件' }}
      </button>

      <!-- 导入差异预览 -->
      <div v-if="importDiff" class="mt-4 bg-gray-50 rounded-lg p-4">
        <h4 class="text-sm font-medium mb-2">
          导入预览 — 来源: {{ importDiff.sourceProject.name }}
        </h4>

        <div class="space-y-2 text-xs">
          <!-- 分类 -->
          <div>
            <span class="font-medium">分类:</span>
            新增 {{ importDiff.categories.added.length }}
            <template v-if="importDiff.categories.conflicted.length > 0">
              · 冲突 {{ importDiff.categories.conflicted.length }}
              <div v-for="c in importDiff.categories.conflicted" :key="c.id" class="ml-4 mt-1">
                <span class="text-gray-500">{{ c.sourceName }} → {{ c.targetName }}</span>
                <button
                  :class="strategies.categories[c.id] === 'overwrite' ? 'text-orange-500' : 'text-gray-400'"
                  class="ml-2 hover:underline"
                  @click="toggleStrategy('categories', c.id)"
                >{{ strategyLabel(strategies.categories[c.id]) }}</button>
              </div>
            </template>
          </div>

          <!-- 功能 -->
          <div>
            <span class="font-medium">功能:</span>
            新增 {{ importDiff.features.added.length }}
            <template v-if="importDiff.features.conflicted.length > 0">
              · 冲突 {{ importDiff.features.conflicted.length }}
              <div v-for="f in importDiff.features.conflicted" :key="f.id" class="ml-4 mt-1">
                <span class="text-gray-500">{{ f.sourceTitle }} → {{ f.targetTitle }}</span>
                <button
                  :class="strategies.features[f.id] === 'overwrite' ? 'text-orange-500' : 'text-gray-400'"
                  class="ml-2 hover:underline"
                  @click="toggleStrategy('features', f.id)"
                >{{ strategyLabel(strategies.features[f.id]) }}</button>
              </div>
            </template>
          </div>

          <!-- 目录 -->
          <div>
            <span class="font-medium">目录:</span>
            新增 {{ importDiff.catalogs.added.length }}
            <template v-if="importDiff.catalogs.conflicted.length > 0">
              · 冲突 {{ importDiff.catalogs.conflicted.length }}
              <div v-for="c in importDiff.catalogs.conflicted" :key="c.id" class="ml-4 mt-1">
                <span class="text-gray-500">{{ c.sourceTitle }} → {{ c.targetTitle }}</span>
                <button
                  :class="strategies.catalogs[c.id] === 'overwrite' ? 'text-orange-500' : 'text-gray-400'"
                  class="ml-2 hover:underline"
                  @click="toggleStrategy('catalogs', c.id)"
                >{{ strategyLabel(strategies.catalogs[c.id]) }}</button>
              </div>
            </template>
          </div>

          <!-- 文档 -->
          <div>
            <span class="font-medium">文档:</span>
            新增 {{ importDiff.documents.added }} · 冲突 {{ importDiff.documents.conflicted }}
          </div>

          <!-- 成员 -->
          <div>
            <span class="font-medium">成员:</span>
            新增 {{ importDiff.projectMembers.added.length }}
            <template v-if="importDiff.projectMembers.unknownUsers.length > 0">
              <span class="text-orange-500 ml-1">
                ({{ importDiff.projectMembers.unknownUsers.length }} 个用户不存在将被跳过)
              </span>
            </template>
          </div>

          <!-- 上传 -->
          <div>
            <span class="font-medium">附件:</span>
            {{ importDiff.uploads.total }} 个 · {{ formatSize(importDiff.uploads.totalSize) }}
            <span v-if="importDiff.uploads.duplicates > 0" class="text-green-500 ml-1">
              ({{ importDiff.uploads.duplicates }} 个已存在将被跳过)
            </span>
          </div>
        </div>

        <div class="flex gap-2 mt-4">
          <button class="btn-primary text-sm" @click="confirmImport">确认导入</button>
          <button class="btn-secondary text-sm" @click="cancelImport">取消</button>
        </div>
      </div>

      <!-- 导入历史 -->
      <div v-if="importHistory.length > 0" class="mt-3">
        <h4 class="text-xs font-medium text-gray-400 mb-1">导入历史</h4>
        <div v-for="t in importHistory" :key="t.id" class="flex items-center gap-2 py-1 text-xs">
          <span :class="t.status === 'completed' ? 'text-green-500' : t.status === 'failed' ? 'text-red-400' : 'text-yellow-500'">
            {{ statusLabel(t.status) }}
          </span>
          <span class="text-gray-400">{{ timeLabel(t.completedAt || t.createdAt) }}</span>
          <button
            class="text-red-300 hover:text-red-500 ml-auto"
            @click="removeTask(t.id)"
          >删</button>
        </div>
      </div>
    </div>

    <!-- 存储清理 -->
    <div class="border-t border-gray-100 pt-4">
      <h3 class="text-sm font-medium mb-2">存储清理</h3>
      <div v-if="orphans.length > 0" class="text-xs text-gray-400 mb-2">
        发现 {{ orphans.length }} 个未被引用的文件，占用 {{ formatSize(orphansTotalSize) }}
        <div v-for="o in orphans.slice(0, 5)" :key="o.path" class="ml-2 text-gray-300">{{ o.path }} ({{ formatSize(o.size) }})</div>
        <div v-if="orphans.length > 5" class="ml-2 text-gray-300">...还有 {{ orphans.length - 5 }} 个</div>
      </div>
      <div v-else-if="!orphansLoading" class="text-xs text-green-500 mb-2">没有孤儿文件，存储整洁。</div>
      <button
        v-if="orphans.length > 0"
        class="btn-danger text-sm"
        :disabled="clearingOrphans"
        @click="clearOrphans"
      >
        {{ clearingOrphans ? '正在清理...' : `清理孤儿文件 (${formatSize(orphansTotalSize)})` }}
      </button>
    </div>
  </div>
</template>
