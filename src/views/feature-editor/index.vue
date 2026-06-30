<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import { showErrorToast, showSuccessToast } from '@/composables/toast'
import { useResponsiveSidebar } from '@/composables/useResponsiveSidebar'
import {
  getFeature,
  updateSectionStatus,
  updateSections,
  deleteOrphaned as apiDeleteOrphaned,
} from '@/api/endpoints/features'
import { getUsers } from '@/api/endpoints/auth'
import { getMembers } from '@/api/endpoints/projects'
import type { FeatureDetail, UpdateSectionStatusBody } from '@shared/types'
import { getStoredUser } from '@/utils/storage'

// API 响应已自动转为 camelCase
interface DefaultSection {
  key: string
  title: string
  description?: string
  status: string
  assignees: string
  reviewNote: string
  reviewStep: number
  statusLog: string
}
interface FeatureDetailExt extends FeatureDetail {
  reviewChain?: string
  defaultSection?: DefaultSection | null
}
interface ApiUser {
  id: string
  username: string
  displayName: string
  role: string
  feishuOpenId: string | null
  feishuName: string | null
  feishuAvatarUrl: string | null
  createdAt: string
}
import TiptapEditor from '@/components/TiptapEditor.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import StatusTransitionModal from '@/components/StatusTransitionModal.vue'
import LoadingState from '@/components/LoadingState.vue'
import SelectDropdown from '@/components/SelectDropdown.vue'
import UserAvatar from '@/components/UserAvatar.vue'

const route = useRoute()
const router = useRouter()

type ComponentStatus =
  | 'draft'
  | 'in_progress'
  | 'completed'
  | 'pending_review'
  | 'rejected'
  | 'approved'
const { isProjectPM, isProjectWriter } = useAuth()

const { dangerConfirm } = useDialog()
const featureId = computed(() => route.params.id as string)
const searchText = computed(() => (route.query.find as string) || undefined)

const feature = ref<FeatureDetail | null>(null)
const loading = ref(true)
const loadError = ref('')

// 无小节对话框
const showNoSectionDialog = ref(false)
const noSectionNewName = ref('')
const noSectionCreating = ref(false)

const currentSection = ref('')
const currentSectionData = computed(() => {
  const sec = feature.value?.sections.find((s) => s.key === currentSection.value)
  if (sec) return sec
  if (currentSection.value === '_default') {
    const ds = (feature.value as FeatureDetailExt)?.defaultSection
    if (ds) return ds
    // 有显式小节时 _default 归入游离文档，从 orphaned 中查找
    const orphanedDoc = feature.value?.orphaned?.find((o) => o.key === '_default')
    if (orphanedDoc) return orphanedDoc
    return {
      key: '_default',
      title: feature.value?.title || '正文',
      status: 'draft' as ComponentStatus,
    }
  }
  return feature.value?.orphaned?.find((o) => o.key === currentSection.value) || null
})

const docId = computed(() => {
  if (!feature.value || !currentSection.value) return ''
  return `${featureId.value}/${currentSection.value}`
})

// 当前小节是否可编辑：无写入权限或 pending_review/approved 时锁定
const editable = computed(() => {
  if (!isProjectWriter.value) return false
  const s = currentSectionData.value?.status || 'draft'
  return s !== 'pending_review' && s !== 'approved'
})

// 当前小节是否为游离文档
const isOrphaned = computed(
  () => feature.value?.orphaned?.some((o) => o.key === currentSection.value) ?? false,
)

// 审核链信息（从项目 review_chain 中获取）
const reviewChain = computed(() => {
  try {
    return JSON.parse((feature.value as FeatureDetailExt)?.reviewChain || '[]') as string[]
  } catch {
    return [] as string[]
  }
})

const currentReviewStep = computed(() => currentSectionData.value?.reviewStep || 0)

// 当前小节的状态变更记录
const sectionStatusLog = computed(() => {
  try {
    return JSON.parse((currentSectionData.value as { statusLog?: string })?.statusLog || '[]') as {
      action: string
      userId: string
      note: string
      step: number
      createdAt: string
    }[]
  } catch {
    return []
  }
})

// 当前用户是否是当前审核环节的审核人
const isCurrentReviewer = computed(() => {
  if (!isProjectPM.value) return false
  const status = currentSectionData.value?.status
  if (status !== 'pending_review') return false
  if (reviewChain.value.length === 0) return true // 无链时任何 PM 可审
  return reviewChain.value[currentReviewStep.value] === currentUserId()
})

function currentUserId(): string {
  const user = getStoredUser<{ id: string }>()
  return user?.id || ''
}

async function loadFeature() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await getFeature(featureId.value)
    feature.value = data as FeatureDetailExt

    // 无显式小节且未创建默认小节 → 弹窗处理
    if (data.sections.length === 0 && !(data as FeatureDetailExt).defaultSection) {
      showNoSectionDialog.value = true
      loading.value = false
      return
    }

    const fromUrl = route.query.section as string | undefined
    if (fromUrl && data.sections.find((s) => s.key === fromUrl)) {
      currentSection.value = fromUrl
    } else if (data.sections.length > 0) {
      currentSection.value = data.sections[0].key
    } else {
      currentSection.value = '_default'
    }
  } catch (e: unknown) {
    loadError.value = '加载失败: ' + (e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

// ---- 无小节对话框操作 ----

function generateSectionKey(): string {
  return crypto.randomUUID().slice(0, 8)
}

function closeNoSectionDialog() {
  showNoSectionDialog.value = false
  router.push('/features')
}

async function createDefaultAndEnter() {
  showNoSectionDialog.value = false
  currentSection.value = '_default'
  // 文档会在编辑器加载时由 ensureDocumentRecord 自动创建
  loading.value = true
  await loadProjectMembers()
  loading.value = false
}

async function addSectionAndEnter() {
  const name = noSectionNewName.value.trim()
  if (!name) return
  noSectionCreating.value = true
  try {
    const key = generateSectionKey()
    await updateSections(featureId.value, { sections: [{ key, title: name }] })
    showNoSectionDialog.value = false
    currentSection.value = key
    // 重新加载 feature 以获取完整的 sections 数据
    await loadFeature()
    await loadProjectMembers()
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '创建小节失败')
  } finally {
    noSectionCreating.value = false
  }
}

onMounted(() => {
  loadFeature().then(() => loadProjectMembers())
  loadUsers()
})

// 切换到其他 feature 时重新加载
watch(featureId, () => {
  loadFeature().then(() => loadProjectMembers())
})

function userDisplayName(u: ApiUser): string {
  return u.feishuName || u.displayName || u.username || '未知'
}

const users = ref<ApiUser[]>([])
const projectMemberRoles = ref<Map<string, string>>(new Map())
const newAssigneeId = ref<string | null>(null)

async function loadUsers() {
  try {
    users.value = (await getUsers(9999, 0)).rows as ApiUser[]
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '加载用户列表失败')
  }
}

async function loadProjectMembers() {
  const pid = feature.value?.projectId
  if (!pid) return
  try {
    const members = await getMembers(pid)
    projectMemberRoles.value = new Map(members.map((m) => [m.id, m.projectRole || 'viewer']))
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '加载项目成员失败')
  }
}

function getCurrentAssignees(): string[] {
  const raw = (currentSectionData.value as { assignees?: string })?.assignees || '[]'
  try {
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

function getUserName(uid: string): string {
  const u = users.value.find((u) => u.id === uid)
  return u ? userDisplayName(u) : '已删除用户'
}

function getUserAvatar(uid: string): string | null {
  return (users.value.find((u) => u.id === uid)?.feishuAvatarUrl as string) || null
}

function availableUsers() {
  const assigned = new Set(getCurrentAssignees())
  return users.value.filter((u) => {
    if (assigned.has(u.id)) return false
    const role = projectMemberRoles.value.get(u.id)
    // 只有 writer 可被指派为编辑者，PM 无需指派
    return role === 'writer'
  })
}

async function addAssignee(sectionKey: string, uid: string) {
  const assignees = [...getCurrentAssignees(), uid]
  await updateAssignees(sectionKey, assignees)
  newAssigneeId.value = null
}

async function removeAssignee(sectionKey: string, uid: string) {
  const assignees = getCurrentAssignees().filter((a) => a !== uid)
  await updateAssignees(sectionKey, assignees)
}

const assigneeError = ref('')

async function updateAssignees(sectionKey: string, assignees: string[]) {
  assigneeError.value = ''
  // 找到对应的 section 对象：_default / 普通 section / 游离文档
  let target: { assignees?: string } | undefined
  if (sectionKey === '_default') {
    const ds = (feature.value as FeatureDetailExt)?.defaultSection
    if (ds) {
      target = ds
    } else {
      // 有显式小节时 _default 可能已归入游离文档，先从 orphaned 查找
      target = feature.value?.orphaned?.find((o) => o.key === '_default') as
        | { assignees?: string }
        | undefined
      if (!target) {
        // 都不存在时创建一个挂到 FeatureDetailExt 上
        const newDs: DefaultSection = {
          key: '_default',
          title: feature.value?.title || '正文',
          status: 'draft',
          assignees: '[]',
          reviewNote: '',
          reviewStep: 0,
          statusLog: '[]',
        }
        ;(feature.value as FeatureDetailExt).defaultSection = newDs
        target = newDs
      }
    }
  } else {
    target = feature.value?.sections.find((s) => s.key === sectionKey) as
      | { assignees?: string }
      | undefined
    if (!target) {
      target = feature.value?.orphaned?.find((o) => o.key === sectionKey) as
        | { assignees?: string }
        | undefined
    }
  }

  try {
    await updateSectionStatus(featureId.value, sectionKey, { assignees })
    if (target) {
      target.assignees = JSON.stringify(assignees)
    }
  } catch (e: unknown) {
    assigneeError.value = '操作失败: ' + (e instanceof Error ? e.message : '网络错误')
  }
}

function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    draft: 'i-lucide-clock',
    in_progress: 'i-lucide-pencil',
    pending_review: 'i-lucide-eye',
    rejected: 'i-lucide-alert-circle',
    approved: 'i-lucide-check-circle',
  }
  return icons[status] || 'i-lucide-clock'
}

function statusLogIcon(action: string): string {
  const icons: Record<string, string> = {
    submitted: 'i-lucide-send text-blue-400 dark:text-blue-300',
    approved: 'i-lucide-check-circle text-green-500 dark:text-green-400',
    rejected: 'i-lucide-x-circle color-danger',
    direct_approved: 'i-lucide-zap text-yellow-500 dark:text-yellow-400',
    reset_to_draft: 'i-lucide-rotate-ccw text-muted',
    reset_to_in_progress: 'i-lucide-rotate-ccw text-orange-400 dark:text-orange-300',
  }
  return icons[action] || 'i-lucide-circle text-muted'
}

function statusLogLabel(action: string): string {
  const labels: Record<string, string> = {
    submitted: '提交审核',
    approved: '审核通过',
    rejected: '退回修改',
    direct_approved: '直接通过',
    reset_to_draft: '重置为未开始',
    reset_to_in_progress: '退回编写中',
  }
  return labels[action] || action
}

// 小节切换同步到 URL（保留 find 等已有参数）
watch(currentSection, (val) => {
  if (val) {
    router.replace({ query: { ...route.query, section: val } })
  }
})

// 更新浏览器标题（打印时作为文件名）
watch([() => feature.value?.title, currentSectionData], () => {
  const parts = [feature.value?.title, currentSectionData.value?.title].filter(Boolean)
  document.title = parts.length > 0 ? parts.join(' - ') : '操作手册编写平台'
})

onUnmounted(() => {
  document.title = '操作手册编写平台'
})

// 状态更新
const showStatusModal = ref(false)
const {
  sidebarOpen: showSections,
  toggleSidebar: toggleSections,
  closeSidebar: closeSections,
} = useResponsiveSidebar()

function selectSection(key: string) {
  currentSection.value = key
  closeSections()
}

const hasStatusTransitions = computed(() => {
  if (!isProjectWriter.value) return false // viewer 无任何状态操作
  const s = currentSectionData.value?.status || 'draft'
  if (!isProjectPM.value) return s === 'draft' || s === 'in_progress' || s === 'rejected'
  return true // PM 始终有可用操作
})

const statusActionLabel = computed(() => {
  const s = currentSectionData.value?.status || 'draft'
  if (!isProjectPM.value && (s === 'draft' || s === 'in_progress')) return '提交审核'
  if (!isProjectPM.value && s === 'rejected') return '重新提交审核'
  if (isProjectPM.value && s === 'pending_review' && isCurrentReviewer.value) return '审核...'
  return '变更状态'
})

async function handleStatusTransition(
  sectionKey: string,
  payload: { target: string; note: string; direct?: boolean },
) {
  const body: Record<string, unknown> = { status: payload.target, reviewNote: payload.note || '' }
  if (payload.direct) body.direct = true
  try {
    await updateSectionStatus(featureId.value, sectionKey, body as UpdateSectionStatusBody)
    showStatusModal.value = false
    await loadFeature()
    showSuccessToast('状态已更新')
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '更新小节状态失败')
  }
}

// 删除游离文档
async function deleteOrphaned(sectionKey: string) {
  if (!(await dangerConfirm(`确定删除游离文档「${sectionKey}」？\n内容不可恢复。`))) return
  try {
    await apiDeleteOrphaned(featureId.value, sectionKey)
    if (feature.value?.orphaned) {
      feature.value.orphaned = feature.value.orphaned.filter((o) => o.key !== sectionKey)
    }
    showSuccessToast('游离文档已删除')
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '删除游离文档失败')
  }
}
</script>

<template>
  <!-- 加载中 -->
  <LoadingState v-if="loading" />

  <!-- 错误 -->
  <div v-else-if="loadError || !feature" class="h-full flex items-center justify-center">
    <div class="text-center">
      <p class="color-danger mb-4">
        {{ loadError || '内容不存在' }}
      </p>
      <router-link to="/features" class="btn-secondary text-sm"> 返回列表 </router-link>
    </div>
  </div>

  <!-- 无小节弹窗 -->
  <div
    v-else-if="showNoSectionDialog && feature"
    class="h-full flex items-center justify-center bg-[var(--c-bg-base)]"
  >
    <div class="bg-surface rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
      <div class="text-center mb-6">
        <span class="i-lucide-file-question w-10 h-10 text-muted inline-block align-middle" />
        <h2 class="text-lg font-semibold mt-3">该内容暂无小节</h2>
        <p class="text-sm text-secondary mt-1">创建时未勾选「创建默认小节」。</p>
      </div>

      <!-- PM：选择创建默认 或 新建小节 -->
      <template v-if="isProjectPM">
        <div class="space-y-3">
          <button class="btn-primary w-full" @click="createDefaultAndEnter">
            创建默认小节（正文）
          </button>
          <div class="flex items-center gap-2 text-xs text-muted px-1">
            <span class="flex-1 h-px bg-border" />
            <span>或</span>
            <span class="flex-1 h-px bg-border" />
          </div>
          <div class="flex gap-2">
            <input
              v-model="noSectionNewName"
              class="input flex-1"
              placeholder="小节标题"
              :disabled="noSectionCreating"
              @keyup.enter="addSectionAndEnter"
            />
            <button
              class="btn-secondary text-sm flex-shrink-0"
              :disabled="!noSectionNewName.trim() || noSectionCreating"
              @click="addSectionAndEnter"
            >
              {{ noSectionCreating ? '创建中...' : '新建并编辑' }}
            </button>
          </div>
        </div>
      </template>

      <!-- 非 PM：只能返回 -->
      <template v-else>
        <p class="text-sm text-secondary text-center mb-4">请联系项目负责人添加小节后再编辑。</p>
        <button class="btn-secondary w-full" @click="closeNoSectionDialog">返回列表</button>
      </template>
    </div>
  </div>

  <!-- 正常编辑器 -->
  <div v-else class="h-full flex flex-col">
    <header
      class="flex items-center justify-between px-3 sm:px-6 py-3 bg-surface border-b border-default"
    >
      <div class="flex items-center gap-4">
        <router-link to="/features" class="text-muted hover:text-secondary">
          <span class="i-lucide-arrow-left w-4 h-4 inline-block align-middle mr-1" />返回
        </router-link>
        <h1 class="text-lg font-semibold truncate">
          {{ feature.title }}
        </h1>
      </div>
      <!-- 移动端大纲按钮 -->
      <button
        class="md:hidden flex items-center gap-1 text-xs color-accent px-2 py-1.5 rounded hover:bg-active flex-shrink-0 ml-2"
        @click="toggleSections"
      >
        <span class="i-lucide-list w-4 h-4" />大纲
      </button>
    </header>

    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧：内容骨架 -->
      <aside
        class="w-72 border-r border-default bg-surface overflow-y-auto flex-shrink-0 hidden md:block"
      >
        <div class="p-4 border-b border-light">
          <div class="text-xs font-semibold text-muted uppercase mb-2">内容概述</div>
          <p class="text-sm text-secondary">
            {{ feature.description }}
          </p>
        </div>

        <div class="p-4">
          <span class="text-xs font-semibold text-muted uppercase">编写进度</span>
          <nav class="space-y-1 mt-3">
            <!-- 无显式小节时显示默认小节 -->
            <template v-if="feature.sections.length === 0">
              <div
                class="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 bg-active color-accent font-medium"
              >
                <span
                  class="i-lucide-file-text w-4 h-4 inline-block flex-shrink-0 text-blue-400 dark:text-blue-300"
                />
                <span class="flex-1 truncate">正文</span>
                <span class="text-xs text-blue-400 dark:text-blue-300">默认</span>
              </div>
            </template>
            <button
              v-for="section in feature.sections"
              :key="section.key"
              class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
              :class="
                currentSection === section.key
                  ? 'bg-active color-accent font-medium'
                  : 'text-secondary hover:bg-hover'
              "
              @click="() => selectSection(section.key)"
            >
              <span
                :class="statusIcon(section.status || 'draft')"
                class="w-4 h-4 inline-block flex-shrink-0"
              />
              <span class="flex-1 truncate">{{ section.title }}</span>
              <StatusBadge
                :status="(section.status || 'draft') as ComponentStatus"
                variant="text"
              />
            </button>
          </nav>
        </div>

        <!-- 游离文档 -->
        <div
          v-if="feature.orphaned && feature.orphaned.length > 0"
          class="px-4 pb-4 border-t border-light pt-3"
        >
          <span class="text-xs font-semibold text-muted uppercase flex items-center gap-1"
            ><span
              class="i-lucide-alert-triangle w-3.5 h-3.5 text-orange-400 dark:text-orange-300 inline-block align-middle"
            />游离文档</span
          >
          <p class="text-xs text-muted mt-1 mb-2">这些文档的小节已从骨架中移除</p>
          <nav class="space-y-1">
            <button
              v-for="o in feature.orphaned"
              :key="o.key"
              class="w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center gap-2"
              :class="
                currentSection === o.key
                  ? 'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300'
                  : 'text-muted hover:bg-hover line-through'
              "
              @click="() => selectSection(o.key)"
            >
              <span class="flex-1 truncate">{{ o.key }}</span>
              <button
                v-if="isProjectPM"
                class="text-red-400 dark:text-red-300 hover:color-danger text-xs flex-shrink-0 p-1"
                @click.stop="() => deleteOrphaned(o.key)"
              >
                <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
              </button>
            </button>
          </nav>
        </div>

        <div v-if="currentSectionData" class="px-4 pb-4">
          <div
            v-if="isOrphaned"
            class="bg-orange-50 dark:bg-orange-500/15 border border-orange-200 dark:border-orange-700 rounded p-2 mb-3 text-xs text-orange-600 dark:text-orange-300"
          >
            <span
              class="i-lucide-alert-triangle w-4 h-4 text-orange-500 dark:text-orange-400 mr-1 inline-block"
            />此小节已从骨架中移除，内容未删除。可将内容合并到现有小节后清除。
          </div>
          <div class="text-xs font-semibold text-muted uppercase mb-1">当前小节</div>
          <p class="text-xs text-secondary mb-3">
            {{ currentSectionData?.description || '' }}
          </p>

          <div class="text-xs font-semibold text-muted uppercase mb-2 flex items-center gap-2">
            状态
            <StatusBadge :status="(currentSectionData.status || 'draft') as ComponentStatus" />
          </div>

          <!-- 状态操作入口 -->
          <div class="space-y-1">
            <button
              v-if="hasStatusTransitions"
              class="btn-primary text-sm w-full"
              @click="showStatusModal = true"
            >
              {{ statusActionLabel }}
            </button>
          </div>

          <StatusTransitionModal
            :visible="showStatusModal"
            :current-status="(currentSectionData?.status || 'draft') as ComponentStatus"
            :can-manage-project="isProjectPM"
            :can-write-content="isProjectWriter"
            :is-current-reviewer="isCurrentReviewer"
            @close="showStatusModal = false"
            @confirm="(payload) => handleStatusTransition(currentSection, payload)"
          />

          <!-- 指派操作人 -->
          <div class="mt-3">
            <div class="text-xs font-semibold text-muted uppercase mb-1">指派编辑者</div>
            <p v-if="assigneeError" class="text-xs color-danger mb-2">
              {{ assigneeError }}
            </p>
            <!-- PM：tag 模式多选 -->
            <div v-if="isProjectPM">
              <div class="flex flex-wrap gap-1 mb-2">
                <span
                  v-for="uid in getCurrentAssignees()"
                  :key="uid"
                  class="inline-flex items-center gap-1 bg-active color-accent px-2 py-0.5 rounded text-xs"
                >
                  <UserAvatar :avatar-url="getUserAvatar(uid)" :name="getUserName(uid)" size="xs" />
                  {{ getUserName(uid) }}
                  <button
                    class="hover:color-danger"
                    @click="() => removeAssignee(currentSection, uid)"
                  >
                    &times;
                  </button>
                </span>
              </div>
              <SelectDropdown
                v-if="availableUsers().length > 0"
                v-model="newAssigneeId"
                placeholder="添加编辑者..."
                :options="[
                  { value: null, label: '添加编辑者...' },
                  ...availableUsers().map((u) => {
                    const name = u.feishuName || u.displayName
                    return {
                      value: u.id,
                      label: userDisplayName(u),
                      avatar: u.feishuAvatarUrl || undefined,
                      name: u.feishuAvatarUrl ? undefined : name,
                    }
                  }),
                ]"
                @update:model-value="
                  (val: string | number | null) => {
                    if (val) addAssignee(currentSection, val as string)
                  }
                "
              />
            </div>
            <!-- 非 PM：只读显示 -->
            <div v-else class="text-sm text-secondary">
              <template v-if="getCurrentAssignees().length > 0">
                <span
                  v-for="(uid, i) in getCurrentAssignees()"
                  :key="uid"
                  class="inline-flex items-center gap-1 mr-1"
                >
                  <UserAvatar :avatar-url="getUserAvatar(uid)" :name="getUserName(uid)" size="xs" />
                  {{ getUserName(uid) }}<span v-if="i < getCurrentAssignees().length - 1">、</span>
                </span>
              </template>
              <span v-else>未指派</span>
            </div>
          </div>

          <!-- 审核链进度 -->
          <div
            v-if="currentSectionData.status === 'pending_review' && reviewChain.length > 0"
            class="mt-3"
          >
            <div class="text-xs font-semibold text-muted uppercase mb-1">审核进度</div>
            <div class="text-sm text-secondary">
              第 {{ currentReviewStep + 1 }} / {{ reviewChain.length }} 步
            </div>
            <div class="text-xs text-muted">
              <UserAvatar
                :avatar-url="getUserAvatar(reviewChain[currentReviewStep])"
                :name="getUserName(reviewChain[currentReviewStep])"
                size="xs"
                class="inline-block align-middle mr-1"
              />
              当前审核人：{{ getUserName(reviewChain[currentReviewStep]) }}
            </div>
          </div>

          <!-- 状态变更记录 -->
          <div v-if="sectionStatusLog.length > 0" class="mt-3">
            <div class="text-xs font-semibold text-muted uppercase mb-1">状态变更记录</div>
            <div
              v-for="(entry, i) in sectionStatusLog.slice().reverse()"
              :key="i"
              class="py-2 border-b border-default"
            >
              <!-- 第一行：图标 + 操作类型 + 时间 -->
              <div class="flex items-center gap-1.5">
                <span
                  :class="statusLogIcon(entry.action)"
                  class="w-4 h-4 inline-block flex-shrink-0"
                />
                <span class="text-sm text-secondary">{{ statusLogLabel(entry.action) }}</span>
                <span class="text-xs text-muted ml-auto">{{
                  entry.createdAt.slice(0, 16).replace('T', ' ')
                }}</span>
              </div>
              <!-- 第二行：用户 + 备注 -->
              <div class="flex items-center gap-1.5 mt-1 ml-5.5">
                <UserAvatar
                  :avatar-url="getUserAvatar(entry.userId)"
                  :name="getUserName(entry.userId)"
                  size="xs"
                />
                <span class="text-xs text-secondary">{{ getUserName(entry.userId) }}</span>
                <span v-if="entry.note" class="text-xs text-muted">· {{ entry.note }}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 移动端大纲抽屉 -->
      <Teleport to="body">
        <Transition name="slide-left">
          <div v-if="showSections" class="fixed inset-0 z-40 md:hidden">
            <div class="absolute inset-0 bg-black/30" @click="closeSections" />
            <aside
              class="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-surface shadow-xl overflow-y-auto"
            >
              <div
                class="sticky top-0 bg-surface border-b border-default flex items-center justify-between px-4 py-3 z-10"
              >
                <span class="text-sm font-semibold text-secondary">大纲</span>
                <button
                  class="w-7 h-7 flex items-center justify-center rounded hover:bg-hover"
                  @click="closeSections"
                >
                  <span class="i-lucide-x w-5 h-5 text-secondary" />
                </button>
              </div>
              <div class="p-4 border-b border-light">
                <div class="text-xs font-semibold text-muted uppercase mb-2">内容概述</div>
                <p class="text-sm text-secondary">
                  {{ feature.description }}
                </p>
              </div>
              <div class="p-4">
                <span class="text-xs font-semibold text-muted uppercase">编写进度</span>
                <nav class="space-y-1 mt-3">
                  <template v-if="feature.sections.length === 0">
                    <div
                      class="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 bg-active color-accent font-medium"
                    >
                      <span
                        class="i-lucide-file-text w-4 h-4 inline-block flex-shrink-0 text-blue-400 dark:text-blue-300"
                      />
                      <span class="flex-1 truncate">正文</span>
                      <span class="text-xs text-blue-400 dark:text-blue-300">默认</span>
                    </div>
                  </template>
                  <button
                    v-for="section in feature.sections"
                    :key="section.key"
                    class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
                    :class="
                      currentSection === section.key
                        ? 'bg-active color-accent font-medium'
                        : 'text-secondary hover:bg-hover'
                    "
                    @click="() => selectSection(section.key)"
                  >
                    <span
                      :class="statusIcon(section.status || 'draft')"
                      class="w-4 h-4 inline-block flex-shrink-0"
                    />
                    <span class="flex-1 truncate">{{ section.title }}</span>
                    <StatusBadge
                      :status="(section.status || 'draft') as ComponentStatus"
                      variant="text"
                    />
                  </button>
                </nav>
              </div>
              <!-- 游离文档 -->
              <div
                v-if="feature.orphaned && feature.orphaned.length > 0"
                class="px-4 pb-4 border-t border-light pt-3"
              >
                <span class="text-xs font-semibold text-muted uppercase flex items-center gap-1"
                  ><span
                    class="i-lucide-alert-triangle w-3.5 h-3.5 text-orange-400 dark:text-orange-300 inline-block align-middle"
                  />游离文档</span
                >
                <nav class="space-y-1 mt-2">
                  <button
                    v-for="o in feature.orphaned"
                    :key="o.key"
                    class="w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center gap-2"
                    :class="
                      currentSection === o.key
                        ? 'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300'
                        : 'text-muted hover:bg-hover line-through'
                    "
                    @click="() => selectSection(o.key)"
                  >
                    <span class="flex-1 truncate">{{ o.key }}</span>
                  </button>
                </nav>
              </div>
            </aside>
          </div>
        </Transition>
      </Teleport>

      <!-- 右侧：编辑器 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-base">
        <TiptapEditor
          :key="docId"
          :doc-id="docId"
          :editable="editable"
          :placeholder="
            editable ? `编写 ${currentSectionData?.title || ''} 的操作说明...` : '当前状态不可编辑'
          "
          :find-text="searchText"
        />
      </main>
    </div>
  </div>
</template>

<style scoped>
/* 侧边栏抽屉过渡 */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: opacity 0.25s ease;
}
.slide-left-enter-from,
.slide-left-leave-to {
  opacity: 0;
}
.slide-left-enter-active aside,
.slide-left-leave-active aside {
  transition: transform 0.25s ease;
}
.slide-left-enter-from aside,
.slide-left-leave-to aside {
  transform: translateX(-100%);
}

@media print {
  header {
    display: none !important;
  }
  aside {
    display: none !important;
  }
  main {
    flex: 1 !important;
  }
}
</style>
