import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DATABASE_PATH || './data/manual.db'

let db: Database.Database
let orm: ReturnType<typeof drizzle>

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

export function getOrm() {
  if (!orm) {
    orm = drizzle(getDb(), { schema })
  }
  return orm
}

// 导出 schema 供路由使用
export { schema }

function columnExists(conn: Database.Database, table: string, column: string): boolean {
  const info = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return info.some(c => c.name === column)
}

function tableExists(conn: Database.Database, table: string): boolean {
  const row = conn.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
  ).get(table)
  return !!row
}

export function initDatabase() {
  const conn = getDb()

  conn.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sections TEXT NOT NULL DEFAULT '[]',
      is_custom INTEGER NOT NULL DEFAULT 0,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT DEFAULT NULL,
      role TEXT NOT NULL DEFAULT 'ops',
      feishu_open_id TEXT DEFAULT NULL,
      feishu_name TEXT DEFAULT NULL,
      feishu_avatar_url TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // 种子默认项目
  conn.prepare(
    "INSERT OR IGNORE INTO projects (id, name, description) VALUES (?, ?, ?)"
  ).run('default', '默认项目', '系统初始化创建')

  // 迁移：为已有表添加 project_id 列（对旧数据库兼容）
  if (!columnExists(conn, 'features', 'project_id')) {
    conn.exec("ALTER TABLE features ADD COLUMN project_id TEXT REFERENCES projects(id)")
    conn.exec("UPDATE features SET project_id = 'default'")
  }

  if (!columnExists(conn, 'catalogs', 'project_id')) {
    conn.exec("ALTER TABLE catalogs ADD COLUMN project_id TEXT REFERENCES projects(id)")
    conn.exec("UPDATE catalogs SET project_id = 'default'")
  }

  // 迁移：添加分类外键
  if (!columnExists(conn, 'features', 'category_id')) {
    conn.exec("ALTER TABLE features ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL")
  }

  // 迁移：移除废弃的 module 列
  if (columnExists(conn, 'features', 'module')) {
    conn.exec("ALTER TABLE features DROP COLUMN module")
  }

  // 迁移：移除废弃的 version 列
  if (columnExists(conn, 'catalogs', 'version')) {
    conn.exec("ALTER TABLE catalogs DROP COLUMN version")
  }

  // 迁移：飞书用户信息
  if (!columnExists(conn, 'users', 'feishu_name')) {
    conn.exec("ALTER TABLE users ADD COLUMN feishu_name TEXT DEFAULT NULL")
  }
  if (!columnExists(conn, 'users', 'feishu_avatar_url')) {
    conn.exec("ALTER TABLE users ADD COLUMN feishu_avatar_url TEXT DEFAULT NULL")
  }

  // 迁移：catalog_versions 表结构更新（version_num → version_major/version_minor）
  if (tableExists(conn, 'catalog_versions') && !columnExists(conn, 'catalog_versions', 'version_major')) {
    conn.exec("DROP TABLE catalog_versions")
    conn.exec(`
      CREATE TABLE catalog_versions (
        id TEXT PRIMARY KEY,
        catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
        version_major INTEGER NOT NULL,
        version_minor INTEGER NOT NULL,
        title TEXT NOT NULL,
        features_snapshot TEXT NOT NULL,
        change_notes TEXT NOT NULL DEFAULT '',
        markdown TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  }

  // 迁移：documents 加 review_note 列
  if (!columnExists(conn, 'documents', 'review_note')) {
    conn.exec("ALTER TABLE documents ADD COLUMN review_note TEXT DEFAULT ''")
  }

  // 迁移：documents.assignee → assignees（多人指派）
  if (columnExists(conn, 'documents', 'assignee')) {
    if (!columnExists(conn, 'documents', 'assignees')) {
      conn.exec("ALTER TABLE documents ADD COLUMN assignees TEXT DEFAULT '[]'")
    }
    // 数据迁移：旧 display_name → 新 user_id
    conn.exec(`
      UPDATE documents SET assignees = (
        SELECT json_array(u.id) FROM users u
        WHERE u.display_name = documents.assignee
          AND documents.assignee IS NOT NULL
          AND documents.assignee != ''
      ) WHERE assignee IS NOT NULL AND assignee != ''
    `)
    // 删除旧列
    conn.exec("ALTER TABLE documents DROP COLUMN assignee")
  }

  // 迁移：documents 加 review_step 列
  if (!columnExists(conn, 'documents', 'review_step')) {
    conn.exec("ALTER TABLE documents ADD COLUMN review_step INTEGER DEFAULT 0")
  }

  // 迁移：documents 加 review_log 列
  if (!columnExists(conn, 'documents', 'review_log')) {
    conn.exec("ALTER TABLE documents ADD COLUMN review_log TEXT DEFAULT '[]'")
  }

  // 迁移：projects 加 review_chain 列
  if (!columnExists(conn, 'projects', 'review_chain')) {
    conn.exec("ALTER TABLE projects ADD COLUMN review_chain TEXT DEFAULT '[]'")
  }

  // 迁移：catalog_versions 加 status_snapshot 列
  if (!columnExists(conn, 'catalog_versions', 'status_snapshot')) {
    conn.exec("ALTER TABLE catalog_versions ADD COLUMN status_snapshot TEXT DEFAULT '{}'")
  }

  // 迁移：users 加 token_version 列（JWT 会话失效机制）
  if (!columnExists(conn, 'users', 'token_version')) {
    conn.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0")
  }

  // 迁移：users 加通知开关列
  if (!columnExists(conn, 'users', 'notify_enabled')) {
    conn.exec("ALTER TABLE users ADD COLUMN notify_enabled INTEGER NOT NULL DEFAULT 1")
  }
  if (!columnExists(conn, 'users', 'notify_prefs')) {
    conn.exec("ALTER TABLE users ADD COLUMN notify_prefs TEXT DEFAULT '{\"assign\":true,\"review\":true,\"project\":true,\"status\":true}'")
  }

  // 迁移：将现有用户加入所有现有项目（确保新增成员表不破坏现状）
  const memberCount = conn.prepare('SELECT COUNT(*) as cnt FROM project_members').get() as { cnt: number }
  if (memberCount.cnt === 0) {
    conn.exec(`
      INSERT OR IGNORE INTO project_members (project_id, user_id)
      SELECT p.id, u.id FROM projects p CROSS JOIN users u
    `)
  }

  // 种子管理员账号
  const admin = conn.prepare('SELECT id FROM users WHERE username = ?').get(
    process.env.ADMIN_USERNAME || 'admin',
  )
  if (!admin) {
    conn.prepare(
      'INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'seed-admin-001',
      process.env.ADMIN_USERNAME || 'admin',
      '管理员',
      process.env.ADMIN_PASSWORD || 'admin123',
      'pm',
    )
    console.log('Admin user seeded.')
  }

  console.log('Database initialized.')
}
