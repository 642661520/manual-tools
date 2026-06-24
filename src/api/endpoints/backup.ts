import { api } from '../client'

export function downloadBackup(): Promise<void> {
  return api.download('/api/backup/download', 'backup.db')
}

export function getBackupUrl(): string {
  return '/api/backup/download'
}
