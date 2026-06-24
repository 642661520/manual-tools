#!/bin/bash
# manual-tools 自动备份脚本
# 用法：bash scripts/backup.sh
# 建议通过 host cron 每天凌晨执行

set -e

BACKUP_DIR="${BACKUP_DIR:-/app/data/backups}"
DB_PATH="${DB_PATH:-/app/data/manual.db}"
UPLOAD_DIR="${UPLOAD_DIR:-/app/data/uploads}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# SQLite 在线安全备份
if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" ".backup $BACKUP_DIR/manual-$TIMESTAMP.db"
  echo "  Database backed up: manual-$TIMESTAMP.db"
else
  echo "  WARNING: Database not found at $DB_PATH"
fi

# 上传文件打包
if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$BACKUP_DIR/uploads-$TIMESTAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  echo "  Uploads backed up: uploads-$TIMESTAMP.tar.gz"
fi

# 清理 30 天前备份
find "$BACKUP_DIR" -name "manual-*.db" -mtime +30 -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "uploads-*.tar.gz" -mtime +30 -delete 2>/dev/null || true
echo "  Old backups cleaned up"

echo "[$(date)] Backup complete."
