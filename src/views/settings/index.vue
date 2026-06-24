<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { useDialog } from '@/composables/useDialog'
import * as authApi from '@/api/endpoints/auth'
import * as projectApi from '@/api/endpoints/projects'
import ModalDialog from '@/components/ModalDialog.vue'
import FormField from '@/components/FormField.vue'
import SelectDropdown from '@/components/SelectDropdown.vue'

const { user } = useAuth()
const { projects, loadProjects, switchProject } = useProject()
const { confirm, dangerConfirm } = useDialog()

const localUsers = ref<any[]>([])
const showAddUser = ref(false)
const addUserError = ref('')
const newUser = ref({ username: '', displayName: '', password: '', role: 'ops' })
const showNewUserPw = ref(false)

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
  if (!pw) {
    addUserError.value = '请输入密码'
    return
  }
  if (pw.length < 8) {
    addUserError.value = '密码不能少于8位'
    return
  }
  if (pw.length > 128) {
    addUserError.value = '密码不能超过128位'
    return
  }

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
    newUser.value = { username: '', displayName: '', password: '', role: 'ops' }
    showNewUserPw.value = false
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
  const labels: Record<string, string> = { pm: '产品', ops: '运维', guest: '游客' }
  return labels[role] || role
}

const roleOptions = [
  { value: 'guest', label: '游客' },
  { value: 'ops', label: '运维' },
  { value: 'pm', label: '产品' },
]

// 项目管理
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
  if (!await dangerConfirm('确定删除此项目？项目下所有主题和目录将被一并删除。')) return
  try {
    await projectApi.deleteProject(id)
    await loadProjects()
    await nextTick()
  } catch { /* ignore */ }
}

// 成员管理
const showMembersDialog = ref(false)
const membersProjectId = ref('')
const membersProjectName = ref('')
const members = ref<any[]>([])
const memberError = ref('')
const newMemberId = ref<string | null>(null)

async function openMembersDialog(projectId: string, projectName: string) {
  membersProjectId.value = projectId
  membersProjectName.value = projectName
  memberError.value = ''
  try {
    members.value = await projectApi.getMembers(projectId)
  } catch { /* ignore */ }
  showMembersDialog.value = true
}

async function addMember(userId: string) {
  memberError.value = ''
  try {
    await projectApi.addMember(membersProjectId.value, userId)
    members.value = await projectApi.getMembers(membersProjectId.value)
  } catch (e: unknown) {
    memberError.value = e instanceof Error ? e.message : '网络错误'
  }
}

async function removeMember(userId: string) {
  memberError.value = ''
  try {
    await projectApi.removeMember(membersProjectId.value, userId)
    members.value = await projectApi.getMembers(membersProjectId.value)
  } catch (e: unknown) {
    memberError.value = e instanceof Error ? e.message : '网络错误'
  }
}

// 获取非成员用户列表
function nonMembers(): any[] {
  const memberIds = new Set(members.value.map((m: any) => m.id))
  return localUsers.value.filter((u: any) => !memberIds.has(u.id))
}

// 审核链配置
const showReviewChainDialog = ref(false)
const reviewChainProjectId = ref('')
const reviewChainProjectName = ref('')
const reviewChainUsers = ref<any[]>([])
const availablePMs = ref<any[]>([])
const reviewChainError = ref('')
const newReviewerId = ref<string | null>(null)

async function openReviewChainDialog(projectId: string, projectName: string) {
  reviewChainProjectId.value = projectId
  reviewChainProjectName.value = projectName
  reviewChainError.value = ''
  newReviewerId.value = null
  try {
    const data = await projectApi.getReviewChain(projectId)
    reviewChainUsers.value = data.chain || []
    availablePMs.value = data.availablePMs || []
  } catch { /* ignore */ }
  showReviewChainDialog.value = true
}

async function saveReviewChain() {
  reviewChainError.value = ''
  try {
    const chain = reviewChainUsers.value.map((u: any) => u.id)
    await projectApi.updateReviewChain(reviewChainProjectId.value, chain)
    showReviewChainDialog.value = false
  } catch (e: unknown) {
    reviewChainError.value = e instanceof Error ? e.message : '网络错误'
  }
}

function addReviewer(uid: string) {
  const user = availablePMs.value.find((p: any) => p.id === uid)
  if (user) {
    reviewChainUsers.value.push(user)
    availablePMs.value = availablePMs.value.filter((p: any) => p.id !== uid)
  }
  newReviewerId.value = null
}

function removeReviewer(index: number) {
  const removed = reviewChainUsers.value[index]
  reviewChainUsers.value.splice(index, 1)
  if (removed) {
    availablePMs.value.push(removed)
  }
}

function moveReviewer(index: number, direction: -1 | 1) {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= reviewChainUsers.value.length) return
  const temp = reviewChainUsers.value[index]
  reviewChainUsers.value[index] = reviewChainUsers.value[newIndex]
  reviewChainUsers.value[newIndex] = temp
}

onMounted(() => {
  loadUsers()
  loadProjects()
})
</script>

<template>
  <div class="p-6 max-w-2xl mx-auto h-full overflow-y-auto">
    <h1 class="text-2xl font-bold mb-6">设置</h1>

    <!-- 项目管理（仅 PM 可见） -->

    <!-- 项目管理（仅 PM 可见） -->
    <div v-if="user?.role === 'pm'" class="card mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-gray-500">项目管理</h2>
        <button class="btn-primary text-sm" @click="showAddProject = true"><span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />新建项目</button>
      </div>

      <div v-for="p in projects" :key="p.id" class="flex items-center gap-3 py-3 border-t border-gray-100">
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm truncate">{{ p.name }}</div>
          <div class="text-xs text-gray-400 truncate">{{ p.description || '无描述' }}</div>
        </div>
        <button class="text-blue-400 hover:text-blue-600 text-sm" @click="openEditProject(p)">编辑</button>
        <button class="text-green-500 hover:text-green-700 text-sm" @click="openMembersDialog(p.id, p.name)">成员</button>
        <button class="text-purple-500 hover:text-purple-700 text-sm" @click="openReviewChainDialog(p.id, p.name)">审核链</button>
        <button
          class="text-red-400 hover:text-red-600 text-sm"
          :disabled="p.id === 'default'"
          :title="p.id === 'default' ? '不能删除默认项目' : '删除'"
          @click="deleteProject(p.id)"
        ><span class="i-lucide-x w-4 h-4 inline-block align-middle" /></button>
      </div>
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

    <!-- 成员管理 -->
    <ModalDialog
      :visible="showMembersDialog"
      :title="'项目成员 — ' + membersProjectName"
      confirm-text=""
      cancel-text="关闭"
      :error="memberError"
      @close="showMembersDialog = false"
    >
      <div class="space-y-3">
        <!-- 当前成员 -->
        <div v-if="members.length === 0" class="text-sm text-gray-400 py-2">暂无成员</div>
        <div v-for="m in members" :key="m.id" class="flex items-center gap-2 py-1.5 border-b border-gray-50">
          <img v-if="m.feishuAvatarUrl" :src="m.feishuAvatarUrl" class="w-6 h-6 rounded-full flex-shrink-0" alt="" />
          <span v-else class="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-500 text-xs font-semibold flex-shrink-0">{{ (m.feishuName || m.displayName || m.username || '?')[0] }}</span>
          <div class="flex-1 min-w-0">
            <span class="text-sm">{{ m.feishuName || m.displayName }}</span>
            <span class="text-xs text-gray-400 ml-1">({{ roleLabel(m.role) }})</span>
          </div>
          <button class="text-red-400 hover:text-red-600 text-xs" @click="removeMember(m.id)">移除</button>
        </div>
        <!-- 添加成员 -->
        <div class="pt-2">
          <FormField label="添加成员">
            <div class="flex gap-2">
              <SelectDropdown
                v-model="newMemberId"
                :key="membersProjectId"
                width-class="flex-1"
                placeholder="选择用户..."
                :options="nonMembers().map((u: any) => {
                  const name = u.feishuName || u.displayName
                  return {
                    value: u.id,
                    label: `${name} (${roleLabel(u.role)})`,
                    avatar: u.feishuAvatarUrl || undefined,
                    initial: u.feishuAvatarUrl ? undefined : (name || '?')[0],
                  }
                })"
                @update:model-value="(val: string | number | null) => { if (val) { addMember(val as string); newMemberId = null } }"
              />
            </div>
          </FormField>
        </div>
      </div>
    </ModalDialog>

    <!-- 审核链配置 -->
    <ModalDialog
      :visible="showReviewChainDialog"
      :title="'审核流程 — ' + reviewChainProjectName"
      confirm-text="保存"
      cancel-text="关闭"
      :error="reviewChainError"
      @close="showReviewChainDialog = false"
      @confirm="saveReviewChain"
    >
      <div class="space-y-3">
        <div v-if="reviewChainUsers.length === 0" class="text-sm text-gray-400 py-2">
          未手动配置，将使用默认顺序：所有项目产品按姓名排序
        </div>
        <div v-for="(u, i) in reviewChainUsers" :key="u.id" class="flex items-center gap-2 py-1.5 border-b border-gray-50">
          <span class="text-xs text-gray-400 w-6">{{ i + 1 }}.</span>
          <img v-if="u.feishuAvatarUrl" :src="u.feishuAvatarUrl" class="w-6 h-6 rounded-full flex-shrink-0" alt="" />
          <span v-else class="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-500 text-xs font-semibold flex-shrink-0">{{ (u.feishuName || u.displayName || u.username || '?')[0] }}</span>
          <div class="flex-1 min-w-0">
            <span class="text-sm">{{ u.feishuName || u.displayName }}</span>
            <span class="text-xs text-gray-400 ml-1">(产品)</span>
          </div>
          <button
            class="text-gray-400 hover:text-gray-600 text-xs"
            :disabled="i === 0"
            @click="moveReviewer(i, -1)"
          >↑</button>
          <button
            class="text-gray-400 hover:text-gray-600 text-xs"
            :disabled="i === reviewChainUsers.length - 1"
            @click="moveReviewer(i, 1)"
          >↓</button>
          <button class="text-red-400 hover:text-red-600 text-xs" @click="removeReviewer(i)">移除</button>
        </div>
        <div class="pt-2" v-if="availablePMs.length > 0">
          <FormField label="添加审核人">
            <SelectDropdown
              v-model="newReviewerId"
              placeholder="选择产品..."
              :options="[{ value: null, label: '选择产品...' }, ...availablePMs.map((u: any) => {
                const name = u.feishuName || u.displayName
                return {
                  value: u.id,
                  label: `${name} (产品)`,
                  avatar: u.feishuAvatarUrl || undefined,
                  initial: u.feishuAvatarUrl ? undefined : (name || '?')[0],
                }
              })]"
              @update:model-value="(val: string | number | null) => { if (val) addReviewer(val as string) }"
            />
          </FormField>
        </div>
      </div>
    </ModalDialog>

    <!-- 账号管理（仅 PM 可见） -->
    <div v-if="user?.role === 'pm'" class="card mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-gray-500">账号管理</h2>
        <button class="btn-primary text-sm" @click="showAddUser = true"><span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />添加账号</button>
      </div>

      <div v-if="localUsers.length === 0" class="text-sm text-gray-400 py-4 text-center">暂无账号</div>

      <div v-for="u in localUsers" :key="u.id" class="flex items-center gap-3 py-3 border-t border-gray-100">
        <img
          v-if="u.feishuAvatarUrl"
          :src="u.feishuAvatarUrl"
          class="w-8 h-8 rounded-full flex-shrink-0"
          alt=""
        />
        <span v-else class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-500 text-sm font-semibold flex-shrink-0">{{ (u.feishuName || u.displayName || u.username || '?')[0] }}</span>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm truncate">
            {{ u.feishuName || u.displayName }}
          </div>
          <div class="text-xs text-gray-400 truncate">{{ u.username }} · {{ roleLabel(u.role) }}</div>
        </div>
        <SelectDropdown
          width-class="w-24"
          :model-value="u.role"
          :options="roleOptions"
          @update:model-value="(val: string | number | null) => changeUserRole(u.id, val as string)"
        />
        <button class="text-red-400 hover:text-red-600 text-sm flex-shrink-0" @click="deleteUser(u.id)">删除</button>
      </div>
    </div>

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
          <div class="relative">
            <input v-model="newUser.password" class="input pr-8" :type="showNewUserPw ? 'text' : 'password'" placeholder="至少8位，含大小写字母、数字、特殊字符中至少3种" />
            <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" @click="showNewUserPw = !showNewUserPw">
              <span :class="showNewUserPw ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="w-4 h-4 inline-block align-middle" />
            </button>
          </div>
        </FormField>
        <FormField label="角色">
          <SelectDropdown
            v-model="newUser.role"
            :options="[
              { value: 'guest', label: '游客' },
              { value: 'ops', label: '运维' },
              { value: 'pm', label: '产品' },
            ]"
          />
        </FormField>
      </div>
    </ModalDialog>
  </div>
</template>
