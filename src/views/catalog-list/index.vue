<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useProject } from '@/composables/useProject'
import { useAuth } from '@/composables/useAuth'
import { useDialog } from '@/composables/useDialog'
import { getTitleHash, getCoverColors } from '@/composables/useCoverColors'
import { getCatalogs, deleteCatalog as apiDeleteCatalog } from '@/api/endpoints/catalogs'
import type { CatalogInfo } from '@shared/types'
import PageHeader from '@/components/PageHeader.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import CreateEditManualModal from '@/components/CreateEditManualModal.vue'

const router = useRouter()
const { currentProjectId } = useProject()
const { canManageProject } = useAuth()
const { dangerConfirm } = useDialog()

const catalogs = ref<CatalogInfo[]>([])
const loading = ref(false)

// 弹窗状态
const modalVisible = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editTarget = ref<CatalogInfo | null>(null)

// ====== 数据解析（列表接口返回原始 DB 行，JSON 字段为字符串） ======

interface CatalogRowRaw {
  id: string
  title: string
  targets: string
  features: string
  cover_info: string
  project_id: string
  created_at: string
  updated_at: string
}

function parseFeatures(featuresRaw: unknown): CatalogInfo['features'] {
  if (Array.isArray(featuresRaw)) return featuresRaw as CatalogInfo['features']
  if (typeof featuresRaw === 'string') {
    try {
      return JSON.parse(featuresRaw) as CatalogInfo['features']
    } catch {
      return []
    }
  }
  return []
}

function parseCoverInfo(coverRaw: unknown): Record<string, string> {
  if (typeof coverRaw === 'object' && coverRaw !== null) return coverRaw as Record<string, string>
  if (typeof coverRaw === 'string') {
    try {
      return JSON.parse(coverRaw) as Record<string, string>
    } catch {
      return {}
    }
  }
  return {}
}

// 计算手册内章数（含 Part 内的 feature）
function countFeatures(cat: CatalogInfo): number {
  const features = parseFeatures((cat as unknown as CatalogRowRaw).features || cat.features)
  let count = 0
  for (const entry of features) {
    if ((entry as { type?: string }).type === 'part') {
      count += ((entry as { features?: Array<unknown> }).features || []).length
    } else {
      count++
    }
  }
  return count
}

// 书封颜色（基于 title hash）
function getBookColor(title: string): ReturnType<typeof getCoverColors> {
  return getCoverColors(getTitleHash(title))
}

// 副标题
function getSubtitle(cat: CatalogInfo): string {
  const cover = parseCoverInfo((cat as unknown as CatalogRowRaw).cover_info || cat.coverInfo)
  return cover.subtitle || ''
}

// 格式化日期
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

// ====== 数据加载 ======

async function loadCatalogs() {
  loading.value = true
  try {
    catalogs.value = await getCatalogs(currentProjectId.value || undefined)
  } finally {
    loading.value = false
  }
}

// ====== 操作 ======

function goToPreview(id: string) {
  router.push(`/manuals/${id}`)
}

function goToEdit(id: string) {
  router.push(`/manuals/${id}/edit`)
}

function openCreateModal() {
  modalMode.value = 'create'
  editTarget.value = null
  modalVisible.value = true
}

function openEditModal(cat: CatalogInfo) {
  modalMode.value = 'edit'
  editTarget.value = cat
  modalVisible.value = true
}

function onModalSaved() {
  loadCatalogs()
}

async function handleDelete(id: string, title: string) {
  const ok = await dangerConfirm(
    `确定删除手册「${title}」？删除后无法恢复，已发布的版本也会被删除。`,
  )
  if (!ok) return
  try {
    await apiDeleteCatalog(id)
    catalogs.value = catalogs.value.filter((c) => c.id !== id)
  } catch {
    // 错误由 api client 统一处理
  }
}

// 排序
const sortedCatalogs = computed(() => {
  return [...catalogs.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})

onMounted(loadCatalogs)
watch(currentProjectId, () => {
  if (currentProjectId.value) loadCatalogs()
})
</script>

<template>
  <div class="h-full flex flex-col">
    <PageHeader>
      <template #left>
        <span class="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <span class="i-lucide-books w-5 h-5 inline-block align-middle text-blue-600" />
          手册
        </span>
      </template>
      <template #right>
        <button v-if="canManageProject" class="btn-primary text-sm" @click="openCreateModal">
          <span class="i-lucide-plus w-4 h-4 inline-block align-middle" />
          新建手册
        </button>
      </template>
    </PageHeader>

    <div class="flex-1 overflow-y-auto px-6 pb-8">
      <LoadingState v-if="loading" message="加载手册中..." />

      <!-- 空状态 -->
      <div v-else-if="catalogs.length === 0" class="flex items-center justify-center pt-24">
        <EmptyState
          icon="i-lucide-books"
          title="暂无手册"
          :description="canManageProject ? '创建第一本手册，开始编排操作文档' : '暂无可查看的手册'"
        >
          <button v-if="canManageProject" class="btn-primary mt-4" @click="openCreateModal">
            <span class="i-lucide-plus w-4 h-4 inline-block align-middle" />
            新建手册
          </button>
        </EmptyState>
      </div>

      <!-- 书架网格 -->
      <div
        v-else
        class="grid gap-3 sm:gap-4 lg:gap-5 pt-2"
        style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))"
      >
        <div v-for="cat in sortedCatalogs" :key="cat.id" class="group">
          <!-- 书封（点击 → 预览） -->
          <div
            class="relative rounded-lg shadow-md overflow-hidden transition-all duration-200 group-hover:shadow-lg group-hover:-translate-y-1 cursor-pointer"
            style="aspect-ratio: 3/4"
            @click="goToPreview(cat.id)"
          >
            <!-- 书封背景层 -->
            <div class="absolute inset-0 select-none">
              <!-- Layer 1: 对角渐变背景 -->
              <div
                class="absolute inset-0"
                :style="{ background: getBookColor(cat.title).gradient }"
              />
              <!-- Layer 2: 斜纹纹理 -->
              <div class="absolute inset-0 cover-pattern" />
              <!-- Layer 3: 暗角效果 -->
              <div class="absolute inset-0 cover-vignette" />
              <!-- 顶部装饰条 -->
              <div
                class="absolute top-0 left-10px right-0 h-4px"
                :style="{ background: getBookColor(cat.title).accent }"
              />
              <!-- 书脊 -->
              <div
                class="absolute left-0 top-0 bottom-0 w-10px"
                :style="{ background: getBookColor(cat.title).spine }"
              >
                <span
                  class="absolute inset-0 text-white/35 text-7px font-medium tracking-widest flex items-center justify-center"
                  style="writing-mode: vertical-rl; text-orientation: mixed; padding: 4px 0"
                  >{{ cat.title }}</span
                >
              </div>
              <!-- 装饰边框（两层嵌套，在书脊右侧） -->
              <div
                class="absolute top-12px left-16px right-12px bottom-12px rounded-sm border border-white/12"
              />
              <div
                class="absolute top-14px left-18px right-14px bottom-14px rounded-sm border border-white/7"
              />
            </div>

            <!-- 封面内容 -->
            <div
              class="absolute inset-0 left-10px flex flex-col items-center justify-center p-4 z-1"
            >
              <!-- 顶部标签 -->
              <span
                class="text-white/35 text-10px font-medium tracking-widest uppercase mb-auto mt-6"
              >
                操作手册
              </span>

              <!-- 图标 -->
              <span class="i-lucide-book-open w-9 h-9 text-white/35 mb-4" />

              <!-- 书名 -->
              <span
                class="text-white font-bold text-center leading-snug text-sm"
                style="text-shadow: 0 1px 4px rgba(0, 0, 0, 0.2)"
                >{{ cat.title }}</span
              >

              <!-- 副标题 -->
              <p
                v-if="getSubtitle(cat)"
                class="text-white/60 text-xs mt-1.5 text-center line-clamp-2 max-w-85%"
              >
                {{ getSubtitle(cat) }}
              </p>

              <!-- 底部弹性分隔（保持封面内容居中） -->
              <span class="mt-auto mb-0" />
            </div>

            <!-- 悬停遮罩提示 -->
            <div
              class="absolute inset-0 bg-black/0 opacity-0 group-hover:opacity-100 group-hover:bg-black/15 transition-all duration-200 flex items-center justify-center z-2 pointer-events-none"
            >
              <span class="text-white text-xs font-medium bg-black/40 px-3 py-1.5 rounded-full">
                点击预览
              </span>
            </div>
          </div>

          <!-- 卡片底部：信息 + 操作 -->
          <div class="mt-2.5 px-1">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-gray-800 truncate">{{ cat.title }}</p>
                <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
                  <span>{{ countFeatures(cat) }} 章</span>
                  <span class="text-gray-200">&middot;</span>
                  <span>{{ formatDate(cat.updatedAt) }}</span>
                </div>
              </div>
              <div v-if="canManageProject" class="flex items-center gap-0.5 flex-shrink-0">
                <button
                  class="text-gray-300 hover:text-blue-500 p-1 transition-colors"
                  v-tooltip="'编辑信息'"
                  @click.stop="openEditModal(cat)"
                >
                  <span class="i-lucide-pencil w-3.5 h-3.5 inline-block align-middle" />
                </button>
              </div>
            </div>
            <!-- 操作按钮 -->
            <div v-if="canManageProject" class="flex items-center gap-2 mt-2">
              <button
                class="flex-1 text-xs text-gray-500 hover:text-blue-600 bg-gray-50 hover:bg-blue-50 py-1.5 rounded-md transition-colors"
                @click.stop="goToEdit(cat.id)"
              >
                <span class="i-lucide-list-tree w-3.5 h-3.5 inline-block align-middle mr-1" />编排
              </button>
              <button
                class="text-xs text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50 px-2 py-1.5 rounded-md transition-colors"
                @click.stop="handleDelete(cat.id, cat.title)"
              >
                <span class="i-lucide-trash-2 w-3.5 h-3.5 inline-block align-middle" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建/编辑弹窗 -->
    <CreateEditManualModal
      :visible="modalVisible"
      :mode="modalMode"
      :catalog="editTarget"
      @close="modalVisible = false"
      @saved="onModalSaved"
    />
  </div>
</template>

<style scoped>
/* 书封斜纹纹理 */
.cover-pattern {
  background-image: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 3px,
    rgba(255, 255, 255, 0.03) 3px,
    rgba(255, 255, 255, 0.03) 6px
  );
  pointer-events: none;
}

/* 书封暗角效果 */
.cover-vignette {
  background: radial-gradient(ellipse at 40% 45%, transparent 55%, rgba(0, 0, 0, 0.15) 100%);
  pointer-events: none;
}
</style>
