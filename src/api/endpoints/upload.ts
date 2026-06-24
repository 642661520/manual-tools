import { api } from '../client'
import type { UploadImageResponse } from '@shared/types'

export function uploadImage(file: File): Promise<UploadImageResponse> {
  const fd = new FormData()
  fd.append('file', file)
  return api.upload<UploadImageResponse>('/api/upload/image', fd)
}
