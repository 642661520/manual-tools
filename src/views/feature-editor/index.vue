<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import TiptapEditor from '@/components/TiptapEditor.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import LoadingState from '@/components/LoadingState.vue'
import SelectDropdown from '@/components/SelectDropdown.vue'

interface FeatureSection {
  key: string
  title: string
  description?: string
  status?: string
  assignees?: string
  reviewNote?: string
  reviewStep?: number
  reviewLog?: string
}

interface FeatureData {
  id: string
  title: string
  description: string
  sections: FeatureSection[]
  orphaned?: FeatureSection[]
  is_custom: number
  review_chain?: string
  project_id: string
}

const route = useRoute()
const router = useRouter()
const { isPM, isGuest } = useAuth()
const { confirm, dangerConfirm, prompt } = useDialog()
const featureId = computed(() => route.params.id as string)

const feature = ref<FeatureData | null>(null)
const loading = ref(true)
const loadError = ref('')

const currentSection = ref('')
const currentSectionData = computed(() => {
  const sec = feature.value?.sections.find(s => s.key === currentSection.value)
  if (sec) return sec
  return feature.value?.orphaned?.find(o => o.key === currentSection.value) || null
})

const docId = computed(() => {
  if (!feature.value || !currentSection.value) return ''
  return `${featureId.value}/${currentSection.value}`
})

// 当前章节是否可编辑：游客不可编辑，pending_review/approved 时锁定
const editable = computed(() => {
  if (isGuest.value) return false
  const s = currentSectionData.value?.status || 'draft'
  return s !== 'pending_review' && s !== 'approved'
})

// 当前章节是否为游离文档
const isOrphaned = computed(() =>
  feature.value?.orphaned?.some(o => o.key === currentSection.value) ?? false
)

// 审核链信息（从项目 review_chain 中获取）
const reviewChain = computed(() => {
  try { return JSON.parse(feature.value?.review_chain || '[]') as string[] } catch { return [] as string[] }
})

const currentReviewStep = computed(() => currentSectionData.value?.reviewStep || 0)

// 当前章节的审核日志
const sectionReviewLog = computed(() => {
  try { return JSON.parse(currentSectionData.value?.reviewLog || '[]') as { action: string; reviewerId: string; note: string; step: number; created_at: string }[] }
  catch { return [] }
})

// 当前用户是否是当前审核环节的审核人
const isCurrentReviewer = computed(() => {
  if (!isPM.value) return false
  const status = currentSectionData.value?.status
  if (status !== 'pending_review') return false
  if (reviewChain.value.length === 0) return true // 无链时任何 PM 可审
  return reviewChain.value[currentReviewStep.value] === currentUserId()
})

function currentUserId(): string {
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}')
  return user.id || ''
}

async function loadFeature() {
  loading.value = true
  loadError.value = ''
  try {
    const token = localStorage.getItem('auth_token')
    const res = await fetch(`/api/features/${featureId.value}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      loadError.value = '主题不存在'
      return
    }
    const data = await res.json()
    feature.value = data
    const fromUrl = route.query.section as string | undefined
    currentSection.value = (fromUrl && data.sections.find((s: any) => s.key === fromUrl))
      ? fromUrl
      : data.sections[0]?.key || ''
  } catch (e: any) {
    loadError.value = '加载失败: ' + e.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadFeature().then(() => loadProjectMembers())
  loadUsers()
})

// 用户列表（PM 指派用）
interface UserItem {
  id: string
  display_name: string
  feishu_name?: string | null
  feishu_avatar_url?: string | null
}

function userDisplayName(u: UserItem): string {
  return u.feishu_name || u.display_name
}

const users = ref<UserItem[]>([])
const projectMemberIds = ref<Set<string>>(new Set())
const newAssigneeId = ref<string | null>(null)

async function loadUsers() {
  const token = localStorage.getItem('auth_token')
  try {
    const res = await fetch('/api/auth/users', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) users.value = await res.json()
  } catch { /* ignore */ }
}

async function loadProjectMembers() {
  if (!feature.value?.project_id) return
  const token = localStorage.getItem('auth_token')
  try {
    const res = await fetch(`/api/projects/${feature.value.project_id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const members = await res.json() as { id: string }[]
      projectMemberIds.value = new Set(members.map(m => m.id))
    }
  } catch { /* ignore */ }
}

function getCurrentAssignees(): string[] {
  const raw = currentSectionData.value?.assignees || '[]'
  try { return JSON.parse(raw) as string[] } catch { return [] }
}

function getUserName(uid: string): string {
  const u = users.value.find(u => u.id === uid)
  return u ? userDisplayName(u) : uid
}

function getUserAvatar(uid: string): string | null {
  return users.value.find(u => u.id === uid)?.feishu_avatar_url || null
}

function getUserInitial(uid: string): string {
  const u = users.value.find(u => u.id === uid)
  return (u ? (u.feishu_name || u.display_name || '?')[0] : '?')
}

function availableUsers() {
  const assigned = new Set(getCurrentAssignees())
  return users.value.filter(u => !assigned.has(u.id) && projectMemberIds.value.has(u.id))
}

async function addAssignee(sectionKey: string, uid: string) {
  const assignees = [...getCurrentAssignees(), uid]
  await updateAssignees(sectionKey, assignees)
  newAssigneeId.value = null
}

async function removeAssignee(sectionKey: string, uid: string) {
  const assignees = getCurrentAssignees().filter(a => a !== uid)
  await updateAssignees(sectionKey, assignees)
}

async function updateAssignees(sectionKey: string, assignees: string[]) {
  const sec = feature.value?.sections.find(s => s.key === sectionKey)
  try {
    const res = await fetch(`/api/features/${featureId.value}/sections/${sectionKey}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
      },
      body: JSON.stringify({ assignees }),
    })
    if (res.ok && sec) { sec.assignees = JSON.stringify(assignees) }
  } catch { /* ignore */ }
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

// 章节切换同步到 URL
watch(currentSection, (val) => {
  if (val) {
    router.replace({ query: { section: val } })
  }
})

// 状态更新
async function setStatus(sectionKey: string, newStatus: string, reviewNote?: string, direct?: boolean) {
  const sec = feature.value?.sections.find(s => s.key === sectionKey)
  const note = reviewNote !== undefined ? reviewNote
    : (newStatus === 'approved') ? ''
    : (sec?.reviewNote || '')

  const body: Record<string, unknown> = { status: newStatus, reviewNote: note }
  if (direct) body.direct = true
  try {
    const res = await fetch(`/api/features/${featureId.value}/sections/${sectionKey}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
      },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      // 重新加载 feature 以获取服务端更新的 review_step、review_log 等
      if (['pending_review', 'approved', 'rejected'].includes(newStatus)) {
        await loadFeature()
      } else if (sec) {
        sec.status = newStatus; sec.reviewNote = note
      }
    }
  } catch { /* ignore */ }
}

// 运维：提交审核
async function submitForReview(sectionKey: string) {
  if (!await confirm('确定提交审核？')) return
  setStatus(sectionKey, 'pending_review', '')
}

// 运维：PM 退回后重新提交
async function resubmitForReview(sectionKey: string) {
  if (!await confirm('确定重新提交审核？')) return
  setStatus(sectionKey, 'pending_review', '')
}

// PM：审核通过
async function approve(sectionKey: string) {
  setStatus(sectionKey, 'approved', '')
}

// PM：退回修改（必须填写理由）
async function reject(sectionKey: string) {
  const note = await prompt('请填写退回理由：')
  if (!note) return  // 取消或空输入
  setStatus(sectionKey, 'rejected', note.trim())
}

// PM：直接通过（跳过审核链）
async function directApprove(sectionKey: string) {
  if (!await confirm('确定将此章节直接设为已审核？将跳过审核流程。')) return
  setStatus(sectionKey, 'approved', undefined, true)
}

// PM：需要修改（从 approved 打回）
async function requestChanges(sectionKey: string) {
  setStatus(sectionKey, 'in_progress')
}

// PM：重置为未开始
async function resetToDraft(sectionKey: string) {
  if (!await confirm('确定重置为未开始？')) return
  setStatus(sectionKey, 'draft')
}

// 删除游离文档
async function deleteOrphaned(sectionKey: string) {
  if (!await dangerConfirm(`确定删除游离文档「${sectionKey}」？\n内容不可恢复。`)) return
  await fetch(`/api/features/${featureId.value}/orphaned/${sectionKey}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
  })
  if (feature.value?.orphaned) {
    feature.value.orphaned = feature.value.orphaned.filter(o => o.key !== sectionKey)
  }
}
</script>

<template>
  <!-- 加载中 -->
  <LoadingState v-if="loading" />

  <!-- 错误 -->
  <div v-else-if="loadError || !feature" class="h-full flex items-center justify-center">
    <div class="text-center">
      <p class="text-red-500 mb-4">{{ loadError || '主题不存在' }}</p>
      <router-link to="/features" class="btn-secondary text-sm">返回列表</router-link>
    </div>
  </div>

  <!-- 正常编辑器 -->
  <div v-else class="h-full flex flex-col">
    <header class="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200">
      <div class="flex items-center gap-4">
        <router-link to="/features" class="text-gray-400 hover:text-gray-600">
          <span class="i-lucide-arrow-left w-4 h-4 inline-block align-middle mr-1" />返回
        </router-link>
        <h1 class="text-lg font-semibold">{{ feature.title }}</h1>
      </div>
    </header>

    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧：主题骨架 -->
      <aside class="w-72 border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0">
        <div class="p-4 border-b border-gray-100">
          <div class="text-xs font-semibold text-gray-400 uppercase mb-2">主题概述</div>
          <p class="text-sm text-gray-600">{{ feature.description }}</p>
        </div>

        <div class="p-4">
          <span class="text-xs font-semibold text-gray-400 uppercase">编写进度</span>
          <nav class="space-y-1 mt-3">
            <button
              v-for="section in feature.sections"
              :key="section.key"
              class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
              :class="currentSection === section.key
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-50'"
              @click="currentSection = section.key"
            >
              <span :class="statusIcon(section.status || 'draft')" class="w-4 h-4 inline-block flex-shrink-0" />
              <span class="flex-1 truncate">{{ section.title }}</span>
              <StatusBadge :status="(section.status || 'draft') as any" variant="text" />
            </button>
          </nav>
        </div>

        <!-- 游离文档 -->
        <div v-if="feature.orphaned && feature.orphaned.length > 0" class="px-4 pb-4 border-t border-gray-100 pt-3">
          <span class="text-xs font-semibold text-gray-400 uppercase flex items-center gap-1"><span class="i-lucide-alert-triangle w-3.5 h-3.5 text-orange-400 inline-block align-middle" />游离文档</span>
          <p class="text-xs text-gray-400 mt-1 mb-2">这些文档的章节已从骨架中移除</p>
          <nav class="space-y-1">
            <button
              v-for="o in feature.orphaned"
              :key="o.key"
              class="w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center gap-2"
              :class="currentSection === o.key
                ? 'bg-orange-50 text-orange-700'
                : 'text-gray-400 hover:bg-gray-50 line-through'"
              @click="currentSection = o.key"
            >
              <span class="flex-1 truncate">{{ o.key }}</span>
              <button
                v-if="isPM"
                class="text-red-400 hover:text-red-600 text-xs flex-shrink-0 p-1"
                @click.stop="deleteOrphaned(o.key)"
              >
                <span class="i-lucide-x w-4 h-4 inline-block align-middle" />
              </button>
            </button>
          </nav>
        </div>

        <div class="px-4 pb-4" v-if="currentSectionData">
          <div v-if="isOrphaned" class="bg-orange-50 border border-orange-200 rounded p-2 mb-3 text-xs text-orange-600">
            <span class="i-lucide-alert-triangle w-4 h-4 text-orange-500 mr-1 inline-block" />此章节已从骨架中移除，内容未删除。可将内容合并到现有章节后清除。
          </div>
          <div class="text-xs font-semibold text-gray-400 uppercase mb-1">当前章节</div>
          <p class="text-xs text-gray-500 mb-3">{{ currentSectionData.description || '' }}</p>

          <div class="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-2">
            状态
            <StatusBadge :status="(currentSectionData.status || 'draft') as any" />
          </div>

          <!-- 操作按钮 -->
          <div class="space-y-1">
            <!-- 运维：提交审核 -->
            <button
              v-if="!isPM && (currentSectionData.status === 'draft' || currentSectionData.status === 'in_progress')"
              class="btn-primary text-sm w-full"
              @click="submitForReview(currentSection)"
            >
              提交审核
            </button>
            <!-- 运维：PM 退回后重新提交 -->
            <button
              v-if="!isPM && currentSectionData.status === 'rejected'"
              class="btn-primary text-sm w-full"
              @click="resubmitForReview(currentSection)"
            >
              重新提交审核
            </button>
            <!-- PM 审核操作 -->
            <template v-if="isPM && currentSectionData.status === 'pending_review'">
              <template v-if="isCurrentReviewer">
                <button class="btn-primary text-sm w-full !bg-emerald-500 hover:!bg-emerald-600" @click="approve(currentSection)">
                  审核通过
                </button>
                <button class="btn-secondary text-sm w-full !text-orange-600 !border-orange-300 hover:!bg-orange-50" @click="reject(currentSection)">
                  退回修改
                </button>
              </template>
              <div v-else class="text-xs text-gray-400 text-center py-1">
                等待审核中（当前：
                <img v-if="getUserAvatar(reviewChain[currentReviewStep])" :src="getUserAvatar(reviewChain[currentReviewStep])!" class="w-4 h-4 rounded-full inline-block align-middle" alt="" />
                <span v-else class="w-4 h-4 rounded-full bg-blue-100 inline-flex items-center justify-center text-blue-500 text-[8px] font-semibold align-middle">{{ getUserInitial(reviewChain[currentReviewStep]) }}</span>
                {{ getUserName(reviewChain[currentReviewStep]) }}）
              </div>
            </template>
            <!-- PM：已审核的需要修改 -->
            <button
              v-if="isPM && currentSectionData.status === 'approved'"
              class="btn-secondary text-sm w-full !text-orange-600 !border-orange-300 hover:!bg-orange-50"
              @click="requestChanges(currentSection)"
            >
              需要修改
            </button>
            <!-- PM：直接通过（非已审核且非当前审核人） -->
            <button
              v-if="isPM && currentSectionData.status !== 'approved' && !(currentSectionData.status === 'pending_review' && isCurrentReviewer)"
              class="btn-secondary text-sm w-full !text-emerald-600 !border-emerald-300 hover:!bg-emerald-50"
              @click="directApprove(currentSection)"
            >
              直接通过
            </button>
            <!-- PM：重置为未开始 -->
            <button
              v-if="isPM && currentSectionData.status !== 'draft'"
              class="btn-secondary text-sm w-full text-gray-400"
              @click="resetToDraft(currentSection)"
            >
              重置为未开始
            </button>
          </div>

          <!-- 指派操作人 -->
          <div class="mt-3">
            <div class="text-xs font-semibold text-gray-400 uppercase mb-1">指派编写人</div>
            <!-- PM：tag 模式多选 -->
            <div v-if="isPM">
              <div class="flex flex-wrap gap-1 mb-2">
                <span
                  v-for="uid in getCurrentAssignees()"
                  :key="uid"
                  class="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs"
                >
                  <img v-if="getUserAvatar(uid)" :src="getUserAvatar(uid)!" class="w-4 h-4 rounded-full" alt="" />
                  <span v-else class="w-4 h-4 rounded-full bg-blue-100 inline-flex items-center justify-center text-blue-500 text-[8px] font-semibold">{{ getUserInitial(uid) }}</span>
                  {{ getUserName(uid) }}
                  <button @click="removeAssignee(currentSection, uid)" class="hover:text-red-500">&times;</button>
                </span>
              </div>
              <SelectDropdown
                v-if="availableUsers().length > 0"
                v-model="newAssigneeId"
                placeholder="添加编写人..."
                :options="[
                  { value: null, label: '添加编写人...' },
                  ...availableUsers().map(u => {
                    const name = u.feishu_name || u.display_name
                    return {
                      value: u.id,
                      label: userDisplayName(u),
                      avatar: u.feishu_avatar_url || undefined,
                      initial: u.feishu_avatar_url ? undefined : (name || '?')[0],
                    }
                  })
                ]"
                @update:model-value="(val: string | number | null) => { if (val) addAssignee(currentSection, val as string) }"
              />
            </div>
            <!-- 非 PM：只读显示 -->
            <div v-else class="text-sm text-gray-600">
              <template v-if="getCurrentAssignees().length > 0">
                <span v-for="(uid, i) in getCurrentAssignees()" :key="uid" class="inline-flex items-center gap-1 mr-1">
                  <img v-if="getUserAvatar(uid)" :src="getUserAvatar(uid)!" class="w-4 h-4 rounded-full" alt="" />
                  <span v-else class="w-4 h-4 rounded-full bg-blue-100 inline-flex items-center justify-center text-blue-500 text-[8px] font-semibold">{{ getUserInitial(uid) }}</span>
                  {{ getUserName(uid) }}<span v-if="i < getCurrentAssignees().length - 1">、</span>
                </span>
              </template>
              <span v-else>未指派</span>
            </div>
          </div>

          <!-- 审核链进度 -->
          <div v-if="currentSectionData.status === 'pending_review' && reviewChain.length > 0" class="mt-3">
            <div class="text-xs font-semibold text-gray-400 uppercase mb-1">审核进度</div>
            <div class="text-sm text-gray-600">
              第 {{ currentReviewStep + 1 }} / {{ reviewChain.length }} 步
            </div>
            <div class="text-xs text-gray-400">
              <img v-if="getUserAvatar(reviewChain[currentReviewStep])" :src="getUserAvatar(reviewChain[currentReviewStep])!" class="w-4 h-4 rounded-full inline-block align-middle mr-1" alt="" />
              <span v-else class="w-4 h-4 rounded-full bg-blue-100 inline-flex items-center justify-center text-blue-500 text-[8px] font-semibold align-middle mr-1">{{ getUserInitial(reviewChain[currentReviewStep]) }}</span>
              当前审核人：{{ getUserName(reviewChain[currentReviewStep]) }}
            </div>
          </div>

          <!-- 审核历史 -->
          <div v-if="sectionReviewLog.length > 0" class="mt-3">
            <div class="text-xs font-semibold text-gray-400 uppercase mb-1">审核记录</div>
            <div v-for="(entry, i) in sectionReviewLog.slice().reverse()" :key="i" class="text-sm py-1.5 border-b border-gray-50">
              <div class="flex items-center gap-1">
                <span :class="entry.action === 'approved' ? 'text-green-500' : 'text-red-500'">
                  {{ entry.action === 'approved' ? '✓' : '✗' }}
                </span>
                <img v-if="getUserAvatar(entry.reviewerId)" :src="getUserAvatar(entry.reviewerId)!" class="w-4 h-4 rounded-full" alt="" />
                <span v-else class="w-4 h-4 rounded-full bg-blue-100 inline-flex items-center justify-center text-blue-500 text-[8px] font-semibold">{{ getUserInitial(entry.reviewerId) }}</span>
                <span class="font-medium">{{ getUserName(entry.reviewerId) }}</span>
                <span class="text-gray-400">{{ entry.action === 'approved' ? '通过审核' : '退回修改' }}</span>
                <span class="text-xs text-gray-400 ml-auto">{{ entry.created_at.slice(0, 16).replace('T', ' ') }}</span>
              </div>
              <div v-if="entry.note" class="text-gray-500 ml-5 text-xs mt-0.5">{{ entry.note }}</div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 右侧：编辑器 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50">
        <TiptapEditor
          :key="docId"
          :doc-id="docId"
          :editable="editable"
          :placeholder="editable ? `编写 ${currentSectionData?.title || ''} 的操作说明...` : '当前状态不可编辑'"
        />
      </main>
    </div>
  </div>
</template>
