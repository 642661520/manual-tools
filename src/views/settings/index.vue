<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useProject } from '@/composables/useProject'
import { useDialog } from '@/composables/useDialog'
import * as authApi from '@/api/endpoints/auth'
import * as projectApi from '@/api/endpoints/projects'
import * as dataApi from '@/api/endpoints/data-tasks'
import type { UserDetail, OrphanFile } from '@shared/types'
import ModalDialog from '@/components/ModalDialog.vue'
import FormField from '@/components/FormField.vue'
import SelectDropdown from '@/components/SelectDropdown.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'

const { isAdmin } = useAuth()
const { projects, loadProjects } = useProject()
const { confirm, dangerConfirm } = useDialog()

// ===== 用户管理 =====
const localUsers = ref<UserDetail[]>([])
const showAddUser = ref(false)
const addUserError = ref('')
const newUser = ref({ username: '', displayName: '', password: '', role: 'member' })
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
  if (!await dangerConfirm('确定删除此项目？项目下所有主题和目录将被一并删除。')) return
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
    // 轮询等待完成
    let attempts = 0
    while (attempts < 30) {
      await new Promise(r => setTimeout(r, 1000))
      const tasks = await dataApi.listTasks()
      const task = (tasks as any[]).find(t => t.id === taskId)
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

onMounted(() => {
  loadUsers()
  loadProjects()
})
</script>

<template>
  <div class="p-6 max-w-2xl mx-auto h-full overflow-y-auto">
    <h1 class="text-2xl font-bold mb-6">系统设置</h1>

    <!-- 项目管理（仅 admin 可见） -->
    <div v-if="isAdmin" class="card mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-gray-500">项目管理</h2>
        <button class="btn-primary text-sm" @click="showAddProject = true">
          <span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />新建项目
        </button>
      </div>

      <div v-for="p in projects" :key="p.id" class="flex items-center gap-3 py-3 border-t border-gray-100">
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
          title="删除"
          @click="deleteProject(p.id)"
        ><span class="i-lucide-x w-4 h-4 inline-block align-middle" /></button>
        <span v-else class="text-xs text-gray-300 cursor-not-allowed select-none" title="不能删除默认项目">—</span>
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

    <!-- 账号管理（仅 admin 可见） -->
    <div v-if="isAdmin" class="card mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-gray-500">账号管理</h2>
        <button class="btn-primary text-sm" @click="showAddUser = true">
          <span class="i-lucide-plus w-4 h-4 inline-block align-middle mr-1" />添加账号
        </button>
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
          <SelectDropdown v-model="newUser.role" :options="roleOptions" />
        </FormField>
      </div>
    </ModalDialog>

    <!-- 系统备份（仅 admin 可见） -->
    <div v-if="isAdmin" class="card mb-6">
      <h2 class="text-sm font-semibold text-gray-500 mb-3">系统备份</h2>
      <p class="text-xs text-gray-400 mb-3">导出完整数据库文件，用于系统迁移或灾难恢复。</p>
      <ErrorMessage :message="backupError" />
      <button class="btn-primary text-sm" :disabled="backupRunning" @click="startSystemBackup">
        <span class="i-lucide-database w-4 h-4 inline-block align-middle mr-1" />{{ backupRunning ? '备份中...' : '完整备份' }}
      </button>
      <a v-if="backupLink" :href="backupLink" class="text-blue-500 hover:underline text-sm ml-3">下载备份</a>
    </div>

    <!-- 存储清理（仅 admin 可见） -->
    <div v-if="isAdmin" class="card mb-6">
      <h2 class="text-sm font-semibold text-gray-500 mb-3">存储清理</h2>
      <p class="text-xs text-gray-400 mb-3">扫描并清理未被任何文档引用的上传文件。</p>
      <ErrorMessage :message="orphansError" />
      <div class="flex gap-2 mb-3">
        <button class="btn-secondary text-sm" :disabled="orphansLoading" @click="loadOrphans">
          {{ orphansLoading ? '扫描中...' : '扫描孤立文件' }}
        </button>
        <button
          v-if="orphans.length > 0"
          class="btn-danger text-sm"
          @click="handleCleanOrphans"
        >清理 {{ orphans.length }} 个文件 ({{ formatSize(orphansTotalSize) }})</button>
      </div>
      <div v-if="cleanResult" class="text-xs text-green-600">已删除 {{ cleanResult.deleted }} 个文件</div>
      <div v-if="orphans.length > 0" class="text-xs text-gray-400 max-h-32 overflow-y-auto space-y-0.5">
        <div v-for="f in orphans" :key="f.path">{{ f.path }} ({{ formatSize(f.size) }})</div>
      </div>
    </div>
  </div>
</template>