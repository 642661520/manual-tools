<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { showErrorToast, showSuccessToast } from '@/composables/toast'
import { useDialog } from '@/composables/useDialog'
import {
  getMembers,
  addMember,
  removeMember,
  getReviewChain,
  updateReviewChain,
} from '@/api/endpoints/projects'
import type { MemberInfo, ReviewChainMember, UserDetail } from '@shared/types'
import ModalDialog from '@/components/ModalDialog.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import SelectDropdown from '@/components/SelectDropdown.vue'
import SettingsSidebar from '@/components/SettingsSidebar.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { getUsers } from '@/api/endpoints/auth'
import DataManagement from './DataManagement.vue'

const route = useRoute()
const router = useRouter()
const { canManageProject } = useAuth()
const { currentProjectId, currentProject, loadProjects } = useProject()
const { dangerConfirm } = useDialog()

type Tab = 'members' | 'review-chain' | 'data'
const validTabs: Tab[] = ['members', 'review-chain', 'data']
const activeTab = ref<Tab>(
  validTabs.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'members',
)

const projectSettingsTabs = [
  { key: 'members', label: '成员管理', icon: 'i-lucide-users' },
  { key: 'review-chain', label: '审核流程', icon: 'i-lucide-git-branch' },
  { key: 'data', label: '导入导出', icon: 'i-lucide-database' },
]

// ===== 成员管理 =====
const members = ref<MemberInfo[]>([])
const membersError = ref('')
const showAddMember = ref(false)
const addMemberError = ref('')
const selectedUserId = ref('')
const selectedProjectRole = ref<'pm' | 'writer' | 'viewer'>('writer')
const allUsers = ref<UserDetail[]>([])

// 过滤已加入的用户（按 ID 排除）
const nonMemberUsers = computed(() => {
  const memberIds = new Set(members.value.map((m) => m.id))
  return allUsers.value.filter((u) => !memberIds.has(u.id))
})

const projectRoleOptions = [
  { value: 'pm', label: '项目负责人' },
  { value: 'writer', label: '编辑者' },
  { value: 'viewer', label: '查阅者' },
]

async function loadMembers() {
  if (!currentProjectId.value) return
  membersError.value = ''
  try {
    const data = await getMembers(currentProjectId.value)
    members.value = data as unknown as MemberInfo[]
  } catch (e: unknown) {
    membersError.value = e instanceof Error ? e.message : '加载失败'
  }
}

async function loadAllUsers() {
  try {
    const result = await getUsers(9999, 0)
    allUsers.value = result.rows
  } catch (e: unknown) {
    showErrorToast(e instanceof Error ? e.message : '加载用户列表失败')
  }
}

function openAddMember() {
  selectedUserId.value = ''
  selectedProjectRole.value = 'writer'
  addMemberError.value = ''
  loadAllUsers()
  showAddMember.value = true
}

function closeAddMember() {
  showAddMember.value = false
  selectedUserId.value = ''
}

async function handleAddMember() {
  if (!selectedUserId.value) {
    addMemberError.value = '请选择用户'
    return
  }
  addMemberError.value = ''
  try {
    await addMember(currentProjectId.value!, selectedUserId.value, selectedProjectRole.value)
    showAddMember.value = false
    selectedUserId.value = ''
    selectedProjectRole.value = 'writer'
    await loadMembers()
    showSuccessToast('成员已添加')
  } catch (e: unknown) {
    addMemberError.value = e instanceof Error ? e.message : '添加失败'
  }
}

async function handleRemoveMember(targetUserId: string) {
  if (!(await dangerConfirm('确定移除此成员？'))) return
  try {
    await removeMember(currentProjectId.value!, targetUserId)
    await loadMembers()
    showSuccessToast('成员已移除')
  } catch (e: unknown) {
    membersError.value = e instanceof Error ? e.message : '移除失败'
  }
}

async function changeMemberRole(targetUserId: string, newRole: string) {
  try {
    await addMember(currentProjectId.value!, targetUserId, newRole)
    await loadMembers()
    showSuccessToast('成员角色已更新')
  } catch (e: unknown) {
    membersError.value = e instanceof Error ? e.message : '更新失败'
  }
}

// ===== 审核流程 =====
const reviewChain = ref<ReviewChainMember[]>([])
const availablePMs = ref<ReviewChainMember[]>([])
const reviewChainError = ref('')
const reviewChainSaving = ref(false)
const showAddReviewer = ref(false)

// 拖拽状态
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

async function loadReviewChain() {
  if (!currentProjectId.value) return
  reviewChainError.value = ''
  try {
    const data = await getReviewChain(currentProjectId.value)
    reviewChain.value = data.chain
    availablePMs.value = data.availablePMs
  } catch (e: unknown) {
    reviewChainError.value = e instanceof Error ? e.message : '加载失败'
  }
}

async function saveReviewChain() {
  if (reviewChainSaving.value || !currentProjectId.value) return
  reviewChainError.value = ''
  reviewChainSaving.value = true
  try {
    await updateReviewChain(
      currentProjectId.value,
      reviewChain.value.map((c) => c.id),
    )
    await loadReviewChain()
    showSuccessToast('审核流程已保存')
  } catch (e: unknown) {
    reviewChainError.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    reviewChainSaving.value = false
  }
}

async function addToChain(pmId: string) {
  if (reviewChainSaving.value) return
  if (reviewChain.value.some((c) => c.id === pmId)) return
  const pm = availablePMs.value.find((p) => p.id === pmId)
  if (pm) {
    reviewChain.value.push(pm)
    await saveReviewChain()
  }
}

async function removeFromChain(index: number) {
  if (reviewChainSaving.value) return
  reviewChain.value.splice(index, 1)
  await saveReviewChain()
}

// 拖拽排序
function onDragStart(index: number, e: DragEvent) {
  if (reviewChainSaving.value) return
  dragIndex.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number, e: DragEvent) {
  e.preventDefault()
  dragOverIndex.value = index
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDragLeave() {
  dragOverIndex.value = null
}

async function onDrop(index: number) {
  if (dragIndex.value === null || dragIndex.value === index) {
    dragIndex.value = null
    dragOverIndex.value = null
    return
  }
  const arr = [...reviewChain.value]
  const [removed] = arr.splice(dragIndex.value, 1)
  arr.splice(index, 0, removed)
  reviewChain.value = arr
  dragIndex.value = null
  dragOverIndex.value = null
  await saveReviewChain()
}

function onDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}

// 未加入审核链的 PM
const availablePMsFiltered = computed(() =>
  availablePMs.value.filter((p) => !reviewChain.value.some((c) => c.id === p.id)),
)

// ===== 生命周期 =====
onMounted(async () => {
  await loadProjects()
})

watch(activeTab, (tab) => {
  router.replace({ query: { tab } })
})

watch(
  [currentProjectId],
  () => {
    if (currentProjectId.value) {
      loadMembers()
      loadReviewChain()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="!canManageProject" class="p-8 text-center text-secondary">你没有项目负责人权限</div>

  <div v-else class="flex flex-col md:flex-row h-full">
    <SettingsSidebar
      v-model="activeTab"
      :title="`项目设置 / ${currentProject?.name || '未选择'}`"
      :tabs="projectSettingsTabs"
    />

    <!-- 右侧内容区 -->
    <main class="flex-1 overflow-auto p-3 sm:p-6">
      <!-- 成员管理 -->
      <div v-if="activeTab === 'members'">
        <div class="mb-4">
          <h2 class="text-lg font-semibold">项目成员管理</h2>
          <p class="text-xs text-muted mt-0.5">管理项目成员和角色，控制编辑与查阅权限。</p>
        </div>

        <div class="card">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-secondary">成员列表</h3>
            <button class="btn-primary text-sm" @click="openAddMember">
              <span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />添加成员
            </button>
          </div>
          <ErrorMessage :message="membersError" />
          <div v-if="members.length === 0" class="text-muted text-sm py-4 text-center">
            暂无成员
          </div>
          <div
            v-for="m in members"
            :key="m.id"
            class="flex items-center justify-between py-3 border-t border-light first:border-t-0"
          >
            <div class="flex items-center gap-3">
              <UserAvatar
                :avatar-url="(m as any).feishuAvatarUrl"
                :name="m.displayName || m.username"
                size="md"
              />
              <div>
                <div class="text-sm font-medium">
                  {{ (m as any).feishuName || m.displayName }}
                </div>
                <div class="text-xs text-muted">
                  {{ m.username }} ·
                  {{
                    (m as any).role === 'admin'
                      ? '系统管理员'
                      : (m as any).role === 'guest'
                        ? '游客'
                        : '普通用户'
                  }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <SelectDropdown
                width-class="w-36"
                :model-value="(m as any).projectRole || 'writer'"
                :options="projectRoleOptions"
                @update:model-value="
                  (val: string | number | null) => val && changeMemberRole(m.id, val as string)
                "
              />
              <button
                class="text-xs text-red-400 hover:color-danger ml-2"
                @click="() => handleRemoveMember(m.id)"
              >
                移除
              </button>
            </div>
          </div>
        </div>

        <!-- 添加成员弹窗 -->
        <ModalDialog
          :visible="showAddMember"
          title="添加成员"
          confirm-text="添加"
          cancel-text="取消"
          :error="addMemberError"
          @confirm="handleAddMember"
          @close="closeAddMember"
        >
          <div class="mb-3">
            <label class="label">选择用户</label>
            <SelectDropdown
              width-class="w-full"
              placeholder="选择用户"
              :model-value="selectedUserId"
              :options="
                nonMemberUsers.map((u) => {
                  const name = u.feishuName || u.displayName
                  return {
                    value: u.id,
                    label: `${name} (${u.username})`,
                    avatar: u.feishuAvatarUrl || undefined,
                    name: u.feishuAvatarUrl ? undefined : name,
                  }
                })
              "
              @update:model-value="
                (val: string | number | null) => (selectedUserId = (val as string) || '')
              "
            />
          </div>
          <div>
            <label class="label">项目角色</label>
            <SelectDropdown
              width-class="w-full"
              :model-value="selectedProjectRole"
              :options="projectRoleOptions"
              @update:model-value="
                (val: string | number | null) =>
                  (selectedProjectRole = (val as 'pm' | 'writer' | 'viewer') || 'writer')
              "
            />
          </div>
        </ModalDialog>
      </div>

      <!-- 审核链 -->
      <div v-if="activeTab === 'review-chain'">
        <div class="mb-4">
          <h2 class="text-lg font-semibold">审核流程配置</h2>
          <p class="text-xs text-muted mt-0.5">
            审核人按顺序依次审核，提交后第1位先审，通过后流转至下一位。未配置时通知所有项目负责人。
          </p>
        </div>
        <ErrorMessage :message="reviewChainError" />
        <div v-if="reviewChainSaving" class="text-xs color-accent mb-2 flex items-center gap-1">
          <span class="i-lucide-loader-2 w-3.5 h-3.5 animate-spin inline-block" />保存中...
        </div>

        <div class="card">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-secondary">审核人列表</h3>
            <button
              v-if="reviewChain.length > 0 && availablePMsFiltered.length > 0"
              class="btn-primary text-sm"
              :disabled="reviewChainSaving"
              @click="showAddReviewer = true"
            >
              <span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />添加审核人
            </button>
          </div>

          <div v-if="reviewChain.length === 0">
            <div
              class="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-active border border-[var(--c-accent)]/25 mb-3"
            >
              <span class="i-lucide-info w-4 h-4 color-accent flex-shrink-0" />
              <span class="text-sm color-accent">默认模式：提交审核时将通知以下所有项目负责人</span>
            </div>
            <div v-if="availablePMs.length > 0">
              <div
                v-for="pm in availablePMs"
                :key="pm.id"
                class="flex items-center gap-3 py-3 border-t border-light first:border-t-0"
              >
                <UserAvatar
                  :avatar-url="(pm as any).feishuAvatarUrl"
                  :name="(pm as any).feishuName || pm.displayName"
                  size="md"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium">
                    {{ (pm as any).feishuName || pm.displayName }}
                  </div>
                  <div class="text-xs text-muted">
                    {{ pm.username }}
                  </div>
                </div>
                <span class="text-xs text-muted">将收到通知</span>
                <button
                  class="text-xs color-accent hover:color-accent hover:bg-active px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  :disabled="reviewChainSaving"
                  @click="() => addToChain(pm.id)"
                >
                  加入审核链
                </button>
              </div>
            </div>
            <div v-else class="text-muted text-xs text-center py-4">暂无可用的项目负责人</div>
          </div>
          <div v-else>
            <div
              v-for="(pm, index) in reviewChain"
              :key="pm.id"
              class="flex items-center gap-3 py-3 border-t border-light first:border-t-0 transition-colors select-none"
              :class="[
                dragOverIndex === index ? 'bg-active border-x-2 border-[var(--c-accent)]/40' : '',
                dragIndex === index ? 'opacity-50' : '',
                reviewChainSaving
                  ? 'opacity-60 pointer-events-none'
                  : 'cursor-grab active:cursor-grabbing',
              ]"
              :draggable="!reviewChainSaving"
              @dragstart="(e) => onDragStart(index, e)"
              @dragover="(e) => onDragOver(index, e)"
              @dragleave="onDragLeave"
              @drop="() => onDrop(index)"
              @dragend="onDragEnd"
            >
              <span class="i-lucide-grip-vertical w-4 h-4 text-muted flex-shrink-0 cursor-grab" />
              <span class="text-xs text-muted w-5 text-right flex-shrink-0">{{ index + 1 }}.</span>
              <UserAvatar
                :avatar-url="(pm as any).feishuAvatarUrl"
                :name="(pm as any).feishuName || pm.displayName"
                size="md"
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">
                  {{ (pm as any).feishuName || pm.displayName }}
                </div>
                <div class="text-xs text-muted">
                  {{ pm.username }}
                </div>
              </div>
              <button
                class="text-xs text-red-400 hover:color-danger transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="reviewChainSaving"
                @click="() => removeFromChain(index)"
              >
                移除
              </button>
            </div>
            <div
              v-if="availablePMsFiltered.length === 0"
              class="text-xs text-muted pt-3 border-t border-light mt-1"
            >
              所有项目负责人已加入审核链
            </div>
          </div>
        </div>

        <!-- 添加审核人弹窗 -->
        <ModalDialog
          :visible="showAddReviewer"
          title="添加审核人"
          confirm-text=""
          cancel-text="关闭"
          width-class="max-w-lg"
          @close="showAddReviewer = false"
          @confirm="showAddReviewer = false"
        >
          <div v-if="availablePMsFiltered.length === 0" class="text-sm text-muted text-center py-4">
            所有项目负责人已加入审核链
          </div>
          <div v-else class="max-h-80 overflow-y-auto">
            <div
              v-for="pm in availablePMsFiltered"
              :key="pm.id"
              class="flex items-center gap-3 py-3 border-t border-light first:border-t-0"
            >
              <UserAvatar
                :avatar-url="(pm as any).feishuAvatarUrl"
                :name="(pm as any).feishuName || pm.displayName"
                size="md"
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">
                  {{ (pm as any).feishuName || pm.displayName }}
                </div>
                <div class="text-xs text-muted">
                  {{ pm.username }}
                </div>
              </div>
              <button
                class="text-xs color-accent hover:color-accent hover:bg-active px-3 py-1.5 rounded-lg transition-colors border border-[var(--c-accent)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="reviewChainSaving"
                @click="() => addToChain(pm.id)"
              >
                添加
              </button>
            </div>
          </div>
        </ModalDialog>
      </div>

      <!-- 导入导出 -->
      <div v-if="activeTab === 'data'">
        <div class="mb-4">
          <h2 class="text-lg font-semibold">项目导入导出</h2>
          <p class="text-xs text-muted mt-0.5">
            导出项目数据或从 ZIP 文件导入，支持差异预览和冲突处理。
          </p>
        </div>
        <DataManagement />
      </div>
    </main>
  </div>
</template>
