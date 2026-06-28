// ============================================================
// 种子数据定义
// Manual Tools 平台自身的操作手册内容
//
// 文档内容存储在 documents/ 目录（每节一个 .html 文件）
// 目录结构：documents/{feature-key}/{section-key}.html
// Feature 元数据：documents/{feature-key}/feature.json
// ============================================================

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCUMENTS_DIR = path.join(__dirname, 'documents')

/** 种子版本号 — 修改内容后递增此值，系统自动检测并更新 */
export const SEED_VERSION = 1

/**
 * 从 documents/ 目录加载所有文档内容
 * 目录结构: documents/{feature-key}/{section-key}.html
 * 生成 docId: manual-tools:{feature-key}/{section-key}
 */
function loadDocuments(): Record<string, string> {
  const docs: Record<string, string> = {}

  if (!fs.existsSync(DOCUMENTS_DIR)) {
    console.warn('[seed] documents/ 目录不存在，跳过文档加载')
    return docs
  }

  const featureDirs = fs.readdirSync(DOCUMENTS_DIR, { withFileTypes: true })

  for (const dir of featureDirs) {
    if (!dir.isDirectory()) continue
    const featureKey = dir.name
    const featureDir = path.join(DOCUMENTS_DIR, featureKey)
    const files = fs.readdirSync(featureDir)

    for (const file of files) {
      if (!file.endsWith('.html')) continue
      const sectionKey = file.replace('.html', '')
      const docId = `manual-tools:${featureKey}/${sectionKey}`
      const content = fs.readFileSync(path.join(featureDir, file), 'utf-8').trim()
      docs[docId] = content
    }
  }

  return docs
}

/** 从文件系统加载的文档内容映射 */
export const SEED_DOCUMENTS: Record<string, string> = loadDocuments()

// ---- Feature 元数据（从 feature.json 加载） ----

export interface SeedFeature {
  id: string
  title: string
  description: string
  sections: Array<{ key: string; title: string; description: string }>
  is_custom?: number
  category_id: string | null
}

/**
 * 从 documents/{feature}/feature.json 加载 feature 元数据
 */
function loadFeatures(): SeedFeature[] {
  const features: SeedFeature[] = []

  if (!fs.existsSync(DOCUMENTS_DIR)) return features

  const featureDirs = fs.readdirSync(DOCUMENTS_DIR, { withFileTypes: true })

  for (const dir of featureDirs) {
    if (!dir.isDirectory()) continue
    const metaPath = path.join(DOCUMENTS_DIR, dir.name, 'feature.json')
    if (!fs.existsSync(metaPath)) {
      console.warn(`[seed] 缺少 feature.json: documents/${dir.name}/`)
      continue
    }
    try {
      const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      features.push({
        id: raw.id ?? `manual-tools:${dir.name}`,
        title: raw.title,
        description: raw.description,
        sections: raw.sections,
        category_id: raw.category_id ?? null,
        is_custom: raw.is_custom ?? 0,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[seed] 解析 feature.json 失败: documents/${dir.name}/feature.json — ${msg}`)
    }
  }

  return features
}

export const SEED_FEATURES: SeedFeature[] = loadFeatures()

// ---- 分类定义 ----

export const SEED_CATEGORIES = [
  { id: 'cat-overview',   name: '平台概述',   color: '#6366f1', sort_order: 1 },
  { id: 'cat-account',    name: '账号与设置', color: '#0891b2', sort_order: 2 },
  { id: 'cat-projects',   name: '项目管理',   color: '#4f46e5', sort_order: 3 },
  { id: 'cat-writing',    name: '文档编写',   color: '#059669', sort_order: 4 },
  { id: 'cat-review',     name: '审核流程',   color: '#d97706', sort_order: 5 },
  { id: 'cat-publishing', name: '发布与导出', color: '#dc2626', sort_order: 6 },
  { id: 'cat-admin',      name: '系统管理',   color: '#64748b', sort_order: 7 },
]

// ---- 目录定义 ----

export const SEED_CATALOG = {
  id: 'manual-tools-manual',
  title: 'Manual Tools 用户手册',
  targets: ['新用户', '文档编写者', '项目管理员', '系统管理员'],
  features: [
    {
      type: 'part' as const,
      id: 'part-overview',
      title: '平台概述',
      features: [
        { featureId: 'manual-tools:project-overview' },
      ],
    },
    {
      type: 'part' as const,
      id: 'part-account',
      title: '账号与设置',
      features: [
        { featureId: 'manual-tools:feishu-integration' },
        { featureId: 'manual-tools:profile' },
      ],
    },
    {
      type: 'part' as const,
      id: 'part-projects',
      title: '项目管理',
      features: [
        { featureId: 'manual-tools:project-crud' },
        { featureId: 'manual-tools:project-members' },
      ],
    },
    {
      type: 'part' as const,
      id: 'part-writing',
      title: '文档编写',
      features: [
        { featureId: 'manual-tools:editor' },
        { featureId: 'manual-tools:categories' },
        { featureId: 'manual-tools:features' },
        { featureId: 'manual-tools:collaborative-editing' },
        { featureId: 'manual-tools:ai-writing' },
        { featureId: 'manual-tools:media-upload' },
      ],
    },
    {
      type: 'part' as const,
      id: 'part-review',
      title: '审核流程',
      features: [
        { featureId: 'manual-tools:status-workflow' },
        { featureId: 'manual-tools:review-chain' },
        { featureId: 'manual-tools:todos' },
      ],
    },
    {
      type: 'part' as const,
      id: 'part-publishing',
      title: '发布与导出',
      features: [
        { featureId: 'manual-tools:catalog-building' },
        { featureId: 'manual-tools:manual-preview' },
        { featureId: 'manual-tools:version-publishing' },
        { featureId: 'manual-tools:static-site' },
        { featureId: 'manual-tools:pdf-export' },
        { featureId: 'manual-tools:markdown-export' },
        { featureId: 'manual-tools:version-diff' },
      ],
    },
    {
      type: 'part' as const,
      id: 'part-admin',
      title: '系统管理',
      features: [
        { featureId: 'manual-tools:user-management' },
        { featureId: 'manual-tools:permissions' },
        { featureId: 'manual-tools:data-import-export' },
        { featureId: 'manual-tools:search' },
        { featureId: 'manual-tools:audit-log' },
        { featureId: 'manual-tools:cache-management' },
      ],
    },
  ],
  cover_info: {
    title: 'Manual Tools 用户手册',
    subtitle: '操作手册编写平台 · 使用指南',
    version: '1.0.0',
  },
}
