<script setup lang="ts">
/**
 * 通用媒体上传对话框 — 同时处理图片和视频
 * 替代 TiptapEditor 中 ~130 行重复的图片/视频对话框代码
 */
import { ref } from 'vue'
import ModalDialog from '@/components/ModalDialog.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import { uploadImage, uploadVideo } from '@/api/endpoints/upload'
import { useDialog } from '@/composables/useDialog'

const { alert } = useDialog()

export interface MediaUploadResult {
  type: 'image' | 'video'
  src: string
}

const props = defineProps<{
  visible: boolean
  mediaType: 'image' | 'video'
  /** 单位 MB */
  maxSize?: number
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'insert', result: MediaUploadResult): void
}>()

const uploading = ref(false)
const uploadingFile = ref<{ name: string; size: string } | null>(null)
const fileInput = ref<HTMLInputElement>()
const urlValue = ref('')
const urlError = ref('')

const isImage = () => props.mediaType === 'image'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function open() {
  urlValue.value = ''
  urlError.value = ''
  uploadingFile.value = null
  emit('update:visible', true)
}

function cancel() {
  if (uploading.value) return
  emit('update:visible', false)
  urlError.value = ''
}

function confirm() {
  let url = urlValue.value.trim()
  if (!url) {
    urlError.value = '请输入' + (isImage() ? '图片' : '视频') + '链接'
    return
  }
  if (url.startsWith('//')) url = `https:${url}`
  try {
    new URL(url)
  } catch {
    urlError.value = '请输入有效的链接地址'
    return
  }
  emit('insert', { type: props.mediaType, src: url })
  emit('update:visible', false)
}

function triggerUpload() {
  fileInput.value?.click()
}

async function handleUpload(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const maxBytes = (props.maxSize ?? (isImage() ? 10 : 100)) * 1024 * 1024
  if (file.size > maxBytes) {
    await alert(`文件过大，上限 ${props.maxSize ?? (isImage() ? 10 : 100)}MB`)
    return
  }

  uploading.value = true
  uploadingFile.value = { name: file.name, size: formatSize(file.size) }

  try {
    const uploadFn = isImage() ? uploadImage : uploadVideo
    const { url } = await uploadFn(file)
    emit('insert', { type: props.mediaType, src: url })
    emit('update:visible', false)
  } catch (e: unknown) {
    await alert('上传失败: ' + (e instanceof Error ? e.message : '未知错误'))
  } finally {
    uploading.value = false
    uploadingFile.value = null
    target.value = ''
  }
}

// 暴露 open 方法供外部调用
defineExpose({ open })
</script>

<template>
  <ModalDialog
    :visible="visible"
    :title="isImage() ? '插入图片' : '插入视频'"
    :confirm-text="uploading ? '上传中...' : '确定'"
    :loading="uploading"
    width-class="max-w-md"
    @confirm="confirm"
    @cancel="cancel"
  >
    <!-- URL 输入 -->
    <div class="mb-3">
      <label class="block text-xs text-secondary mb-1">
        {{ isImage() ? '图片' : '视频' }}链接
      </label>
      <input
        v-model="urlValue"
        type="text"
        class="input"
        :placeholder="isImage() ? 'https://example.com/image.png' : 'https://example.com/video.mp4'"
        @keyup.enter="confirm"
      />
      <ErrorMessage v-if="urlError" :message="urlError" class="mt-1" />
    </div>

    <!-- 本地上传 -->
    <div class="border-t border-light pt-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-secondary">或上传本地文件</span>
        <button class="btn btn-secondary text-xs" :disabled="uploading" @click="triggerUpload">
          <span class="i-lucide-upload w-3 h-3 inline-block align-middle mr-1" />
          选择文件
        </button>
      </div>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        :accept="isImage() ? 'image/png,image/jpeg,image/gif,image/webp' : 'video/mp4,video/webm'"
        @change="handleUpload"
      />
      <div v-if="uploadingFile" class="mt-2 text-xs text-muted">
        上传中: {{ uploadingFile.name }} ({{ uploadingFile.size }})
      </div>
    </div>
  </ModalDialog>
</template>
