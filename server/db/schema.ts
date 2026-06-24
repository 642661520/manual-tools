import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// 项目
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  reviewChain: text('review_chain').default('[]'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// 分类
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  sortOrder: integer('sort_order').notNull().default(0),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// 主题骨架
export const features = sqliteTable('features', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  sections: text('sections').notNull().default('[]'),
  isCustom: integer('is_custom').notNull().default(0),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  projectId: text('project_id').notNull().references(() => projects.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Y.js 文档
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').notNull().references(() => features.id, { onDelete: 'cascade' }),
  sectionKey: text('section_key').notNull(),
  status: text('status').notNull().default('draft'),
  assignees: text('assignees').default('[]'),
  reviewNote: text('review_note').default(''),
  reviewStep: integer('review_step').default(0),
  reviewLog: text('review_log').default('[]'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// Y.js update 增量存储
export const documentUpdates = sqliteTable('document_updates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  updateData: blob('update_data').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// Y.js 快照
export const documentSnapshots = sqliteTable('document_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  snapshotData: blob('snapshot_data').notNull(),
  updateCount: integer('update_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// 目录编排
export const catalogs = sqliteTable('catalogs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  targets: text('targets').notNull().default('[]'),
  features: text('features').notNull().default('[]'),
  coverInfo: text('cover_info').notNull().default('{}'),
  projectId: text('project_id').notNull().references(() => projects.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// 导出版本快照
export const catalogVersions = sqliteTable('catalog_versions', {
  id: text('id').primaryKey(),
  catalogId: text('catalog_id').notNull().references(() => catalogs.id, { onDelete: 'cascade' }),
  versionMajor: integer('version_major').notNull(),
  versionMinor: integer('version_minor').notNull(),
  title: text('title').notNull(),
  featuresSnapshot: text('features_snapshot').notNull(),
  changeNotes: text('change_notes').notNull().default(''),
  markdown: text('markdown').notNull(),
  statusSnapshot: text('status_snapshot').default('{}'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// 用户
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('ops'),
  feishuOpenId: text('feishu_open_id'),
  feishuName: text('feishu_name'),
  feishuAvatarUrl: text('feishu_avatar_url'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// 项目成员（纯关联，无角色）
export const projectMembers = sqliteTable('project_members', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
})
