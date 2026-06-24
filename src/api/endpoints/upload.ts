import { api } from '../client'
import type { UploadImageResponse } from '@shared/types'

export function uploadImage(file: File | Blob): Promise<UploadImageResponse> {
  const fd = new FormData()
  fd.append('file', file, file instanceof File ? file.name : 'pasted-image.png')
  return api.upload<UploadImageResponse>('/api/v1/upload/image', fd)
}

export function uploadVideo(file: File | Blob): Promise<UploadImageResponse> {
  const fd = new FormData()
  fd.append('file', file, file instanceof File ? file.name : 'recording.mp4')
  return api.upload<UploadImageResponse>('/api/v1/upload/video', fd)
}
