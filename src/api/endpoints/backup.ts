import { api } from '../client'

export function downloadBackup(): Promise<void> {
  return api.download('/api/v1/backup/download', 'backup.db')
}

export function getBackupUrl(): string {
  return '/api/v1/backup/download'
}
