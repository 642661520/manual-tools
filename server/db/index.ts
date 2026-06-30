import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { config } from '../config.js'
import path from 'path'
import fs from 'fs'
import { getLogger } from '../lib/logger.js'

const DB_PATH = config.databasePath

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // 如果配置为 delete 模式，尝试提前清理可能残留的 WAL/SHM 文件
    // （上次 WAL 模式运行崩溃后残留，在 NTFS bind mount 上会导致 SHMOPEN 错误）
    if (config.dbJournalMode !== 'wal') {
      const cleaned: string[] = []
      for (const ext of ['-wal', '-shm']) {
        const p = DB_PATH + ext
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p)
            cleaned.push(ext)
          } catch {
            /* 文件被锁定 */
          }
        }
      }
      if (cleaned.length > 0) {
        log.info({ cleaned }, '已清理残留的 WAL/SHM 文件')
      }
      // 如果 WAL/SHM 文件仍在，说明被锁定无法删除，复制数据库到临时路径绕过
      if (fs.existsSync(DB_PATH + '-wal') || fs.existsSync(DB_PATH + '-shm')) {
        const safeDir = path.join(dir, '.recovery')
        fs.mkdirSync(safeDir, { recursive: true })
        const safePath = path.join(safeDir, path.basename(DB_PATH))
        log.warn({ safePath }, 'WAL 残留文件被锁定无法清理，复制数据库到安全路径打开')
        fs.copyFileSync(DB_PATH, safePath)
        db = new Database(safePath)
      } else {
        db = new Database(DB_PATH)
      }
    } else {
      db = new Database(DB_PATH)
    }

    // 设置 journal_mode
    try {
      db.pragma(`journal_mode = ${config.dbJournalMode}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (config.dbJournalMode === 'wal' && msg.includes('SQLITE_IOERR')) {
        log.warn({ err: msg }, 'WAL 模式不可用（NTFS bind mount 不支持共享内存），降级为 delete')
        db.pragma('journal_mode = delete')
      } else {
        throw e
      }
    }

    db.pragma('foreign_keys = ON')
  }
  return db
}

const log = getLogger()

/** 检查列是否存在（用于幂等迁移） */
function columnExists(conn: ReturnType<typeof getDb>, table: string, column: string): boolean {
  const rows = conn.pragma(`table_info(${table})`) as { name: string }[]
  return rows.some((r) => r.name === column)
}

export function initDatabase() {
  const conn = getDb()

  conn.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      review_chain TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sections TEXT NOT NULL DEFAULT '[]',
      is_custom INTEGER NOT NULL DEFAULT 0,
      project_id TEXT REFERENCES projects(id),
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      section_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      assignees TEXT DEFAULT '[]',
      review_note TEXT DEFAULT '',
      review_step INTEGER DEFAULT 0,
      status_log TEXT DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL,
      update_data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL,
      snapshot_data BLOB NOT NULL,
      update_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS catalogs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      features TEXT NOT NULL DEFAULT '[]',
      cover_info TEXT NOT NULL DEFAULT '{}',
      project_id TEXT REFERENCES projects(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT DEFAULT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      feishu_open_id TEXT DEFAULT NULL,
      feishu_name TEXT DEFAULT NULL,
      feishu_avatar_url TEXT DEFAULT NULL,
      token_version INTEGER NOT NULL DEFAULT 0,
      notify_enabled INTEGER NOT NULL DEFAULT 1,
      notify_prefs TEXT DEFAULT '{"assign":true,"review":true,"project":true,"status":true}',
	      username_changed INTEGER NOT NULL DEFAULT 0,
	      created_at TEXT NOT NULL DEFAULT (datetime('now')),
	      deleted_at TEXT DEFAULT NULL
	    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'viewer',
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      sort_order INTEGER NOT NULL DEFAULT 0,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS catalog_versions (
      id TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
      version_major INTEGER NOT NULL,
      version_minor INTEGER NOT NULL,
      title TEXT NOT NULL,
      features_snapshot TEXT NOT NULL,
      change_notes TEXT NOT NULL DEFAULT '',
      markdown TEXT NOT NULL,
      status_snapshot TEXT DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'project_members',
      features_json TEXT DEFAULT '[]',
      headings_json TEXT DEFAULT '[]',
      publish_scope TEXT NOT NULL DEFAULT 'all',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS data_tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      progress_label TEXT,
      file_path TEXT,
      file_size INTEGER,
      summary TEXT,
      diff_report TEXT,
      error_message TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      expires_at TEXT NOT NULL DEFAULT (datetime('now', '+24 hours'))
    );

    CREATE TABLE IF NOT EXISTS remote_cache (
      url TEXT NOT NULL,
      hash TEXT NOT NULL,
      ext TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      etag TEXT,
      last_modified TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
      fetch_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (url, hash)
    );

    CREATE TABLE IF NOT EXISTS export_cache (
      id TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      options_hash TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // 种子默认项目
  conn
    .prepare('INSERT OR IGNORE INTO projects (id, name, description) VALUES (?, ?, ?)')
    .run('default', '默认项目', '系统初始化创建')

  // 种子元数据表（记录种子数据版本等）
  conn.exec(`
    CREATE TABLE IF NOT EXISTS seed_metadata (
      seed_key TEXT PRIMARY KEY,
      seed_value TEXT NOT NULL
    );
  `)

  // 常用查询索引
  conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_features_project_id ON features(project_id);
    CREATE INDEX IF NOT EXISTS idx_documents_feature_id ON documents(feature_id);
    CREATE INDEX IF NOT EXISTS idx_catalogs_project_id ON catalogs(project_id);
    CREATE INDEX IF NOT EXISTS idx_remote_cache_accessed ON remote_cache(accessed_at);
    CREATE INDEX IF NOT EXISTS idx_export_cache_lookup ON export_cache(catalog_id, type, fingerprint, options_hash);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
    CREATE TABLE IF NOT EXISTS search_docs (
      doc_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      project_id TEXT NOT NULL,
      section_key TEXT NOT NULL DEFAULT '_default'
    );
    CREATE INDEX IF NOT EXISTS idx_search_docs_project ON search_docs(project_id);
  `)

  // 幂等迁移：为旧版本数据库添加 publish_scope 列
  if (!columnExists(conn, 'catalog_versions', 'publish_scope')) {
    conn.exec("ALTER TABLE catalog_versions ADD COLUMN publish_scope TEXT NOT NULL DEFAULT 'all'")
  }

  // 幂等迁移：catalog_versions 添加 status 列
  if (!columnExists(conn, 'catalog_versions', 'status')) {
    conn.exec("ALTER TABLE catalog_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
  }

  // 幂等迁移：review_log 列重命名为 status_log
  if (columnExists(conn, 'documents', 'review_log')) {
    conn.exec('ALTER TABLE documents RENAME COLUMN review_log TO status_log')
  }

  // 幂等迁移：users 添加 deleted_at 列（软删除）
  if (!columnExists(conn, 'users', 'deleted_at')) {
    conn.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT DEFAULT NULL')
  }

  // 种子系统管理员账号
  const admin = conn.prepare('SELECT id FROM users WHERE username = ?').get(config.adminUsername)
  if (!admin) {
    const hashed = bcrypt.hashSync(config.adminPassword, 10)
    conn
      .prepare(
        'INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      )
      .run('seed-admin-001', config.adminUsername, 'admin', hashed, 'admin')
    log.info('admin user seeded')
  }
  // 确保管理员始终在默认项目中（幂等，独立于用户创建）
  conn
    .prepare('INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
    .run('default', 'seed-admin-001', 'pm')

  // 幂等迁移：确保已存在的管理员在默认项目中有 pm 角色（修复旧数据库）
  conn
    .prepare(
      "INSERT OR IGNORE INTO project_members (project_id, user_id, role) SELECT 'default', u.id, 'pm' FROM users u WHERE u.role = 'admin'",
    )
    .run()

  // 清理过期的导出/导入任务文件
  const expiredTasks = conn
    .prepare(
      "SELECT id, file_path FROM data_tasks WHERE expires_at < datetime('now') AND file_path IS NOT NULL",
    )
    .all() as { id: string; file_path: string }[]
  for (const task of expiredTasks) {
    try {
      fs.unlinkSync(task.file_path)
    } catch {
      /* 文件可能已被手动删除 */
    }
    conn.prepare('DELETE FROM data_tasks WHERE id = ?').run(task.id)
  }
  if (expiredTasks.length > 0) {
    log.info({ count: expiredTasks.length }, 'expired data tasks cleaned')
  }

  log.info('database initialized')
}
