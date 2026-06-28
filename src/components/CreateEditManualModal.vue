<script setup lang="ts">
import { ref, watch } from 'vue'
import { useProject } from '@/composables/useProject'
import { createCatalog, updateCatalog } from '@/api/endpoints/catalogs'
import type { CatalogInfo } from '@shared/types'
import ModalDialog from '@/components/ModalDialog.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'

const props = defineProps<{
  visible: boolean
  mode: 'create' | 'edit'
  catalog?: CatalogInfo | null
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const { currentProjectId } = useProject()

const title = ref('')
const subtitle = ref('')
const saving = ref(false)
const formError = ref('')

// 打开弹窗时初始化表单
watch(
  () => props.visible,
  (v) => {
    if (!v) return
    formError.value = ''
    if (props.mode === 'edit' && props.catalog) {
      title.value = props.catalog.title
      const cover =
        typeof props.catalog.coverInfo === 'string'
          ? JSON.parse(props.catalog.coverInfo || '{}')
          : (props.catalog.coverInfo as Record<string, string>) || {}
      subtitle.value = cover.subtitle || ''
    } else {
      title.value = ''
      subtitle.value = ''
    }
  },
)

async function handleSubmit() {
  formError.value = ''
  if (!title.value.trim()) {
    formError.value = '请输入手册名称'
    return
  }
  saving.value = true
  try {
    const coverPayload: Record<string, string> = {}
    if (subtitle.value.trim()) coverPayload.subtitle = subtitle.value.trim()

    if (props.mode === 'create') {
      await createCatalog({
        title: title.value.trim(),
        cover: coverPayload,
        projectId: currentProjectId.value || undefined,
      })
    } else if (props.catalog) {
      await updateCatalog(props.catalog.id, {
        title: title.value.trim(),
        cover: coverPayload,
      })
    }
    emit('saved')
    emit('close')
  } catch (e: unknown) {
    formError.value = e instanceof Error ? e.message : '网络错误，操作失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ModalDialog
    :visible="visible"
    :title="mode === 'create' ? '新建手册' : '编辑手册信息'"
    :confirm-text="mode === 'create' ? '创建' : '保存'"
    cancel-text="取消"
    :loading="saving"
    :error="formError"
    width-class="max-w-md"
    @close="() => emit('close')"
    @confirm="handleSubmit"
  >
    <div class="flex flex-col gap-4">
      <ErrorMessage :message="formError" />
      <div>
        <label class="label">手册名称 <span class="text-red-400">*</span></label>
        <input
          v-model="title"
          class="input"
          placeholder="例如：产品操作手册"
          @keyup.enter="handleSubmit"
        />
      </div>
      <div>
        <label class="label">副标题</label>
        <input
          v-model="subtitle"
          class="input"
          placeholder="显示在封面上的副标题（可选）"
          @keyup.enter="handleSubmit"
        />
      </div>
    </div>
  </ModalDialog>
</template>
