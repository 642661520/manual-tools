import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { config } from '../config.js'
import path from 'path'
import fs from 'fs'

const DB_PATH = config.databasePath

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }
  return db
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
      review_log TEXT DEFAULT '[]',
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
      targets TEXT NOT NULL DEFAULT '[]',
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  conn.prepare(
    "INSERT OR IGNORE INTO projects (id, name, description) VALUES (?, ?, ?)"
  ).run('default', '默认项目', '系统初始化创建')

  // 常用查询索引
  conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_features_project_id ON features(project_id);
    CREATE INDEX IF NOT EXISTS idx_documents_feature_id ON documents(feature_id);
    CREATE INDEX IF NOT EXISTS idx_catalogs_project_id ON catalogs(project_id);
    CREATE INDEX IF NOT EXISTS idx_remote_cache_accessed ON remote_cache(accessed_at);
    CREATE INDEX IF NOT EXISTS idx_export_cache_lookup ON export_cache(catalog_id, type, fingerprint, options_hash);
  `)

  // 种子系统管理员账号
  const admin = conn.prepare('SELECT id FROM users WHERE username = ?').get(
    config.adminUsername,
  )
  if (!admin) {
    const hashed = bcrypt.hashSync(config.adminPassword, 10)
    conn.prepare(
      'INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'seed-admin-001',
      config.adminUsername,
      '系统管理员',
      hashed,
      'admin',
    )
    // 将管理员加入默认项目
    conn.prepare(
      "INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)"
    ).run('default', 'seed-admin-001', 'pm')
    console.log('Admin user seeded.')
  }

  // 清理过期的导出/导入任务文件
  const expiredTasks = conn.prepare(
    "SELECT id, file_path FROM data_tasks WHERE expires_at < datetime('now') AND file_path IS NOT NULL",
  ).all() as { id: string; file_path: string }[]
  for (const task of expiredTasks) {
    try { fs.unlinkSync(task.file_path) } catch { /* 文件可能已被手动删除 */ }
    conn.prepare('DELETE FROM data_tasks WHERE id = ?').run(task.id)
  }
  if (expiredTasks.length > 0) {
    console.log(`Cleaned up ${expiredTasks.length} expired data task(s).`)
  }

  console.log('Database initialized.')
}
