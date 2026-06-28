// ============================================================
// 种子编排逻辑
// 版本检测 → 构建 ZIP → 调用 import-service 导入/更新
// ============================================================

import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { getDb } from '../index.js'
import { config } from '../../config.js'
import { getLogger } from '../../lib/logger.js'
import { analyzeImport, applyImport } from '../../services/import-service.js'
import { assembleManual } from '../../services/manual-assembler.js'
import { buildStaticSite } from '../../services/site-builder/index.js'
import { recordAudit } from '../../services/audit.js'
import { isCatalogPart } from '../../types.js'
import type { CatalogEntry, CatalogFeatureEntry } from '../../types.js'
import { buildSeedZip } from './builder.js'
import { SEED_VERSION } from './content.js'

const SEED_KEY = 'manual_data_version'

function getCurrentSeedVersion(): number {
  const db = getDb()
  const row = db
    .prepare('SELECT seed_value FROM seed_metadata WHERE seed_key = ?')
    .get(SEED_KEY) as { seed_value: string } | undefined
  return row ? parseInt(row.seed_value, 10) : 0
}

function setCurrentSeedVersion(version: number): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO seed_metadata (seed_key, seed_value) VALUES (?, ?)').run(
    SEED_KEY,
    String(version),
  )
}

/** 将冲突列表映射为 overwrite 策略 */
function mapOverwriteAll(items: Array<{ id: string }>): Record<string, 'overwrite'> {
  const result: Record<string, 'overwrite'> = {}
  for (const item of items) {
    result[item.id] = 'overwrite'
  }
  return result
}

/** 从 SEED_DOCUMENTS 构建文档 overwrite 策略（diff 中 documents 只有计数没有 ID 列表） */
async function buildDocumentStrategies(): Promise<Record<string, 'overwrite'>> {
  const content = await import('./content.js')
  const docs: Record<string, string> = content.SEED_DOCUMENTS
  const strategies: Record<string, 'overwrite'> = {}
  for (const docId of Object.keys(docs)) {
    strategies[docId] = 'overwrite'
  }
  return strategies
}

const SEED_CATALOG_ID = 'manual-tools-manual'

/** 为种子目录自动发布一个版本，生成静态文档站点 */
async function publishSeedVersion(): Promise<void> {
  const log = getLogger()
  const db = getDb()

  // 1. 确认目录存在
  const catalogMeta = db
    .prepare('SELECT title, features FROM catalogs WHERE id = ?')
    .get(SEED_CATALOG_ID) as { title: string; features: string } | undefined
  if (!catalogMeta) {
    log.warn({ catalogId: SEED_CATALOG_ID }, '种子目录不存在，跳过自动发布')
    return
  }

  // 2. 构建状态快照（展平 Part 结构，收集所有文档状态）
  const entries: CatalogEntry[] = JSON.parse(catalogMeta.features)
  const flatEntries: CatalogFeatureEntry[] = []
  for (const entry of entries) {
    if (isCatalogPart(entry)) {
      flatEntries.push(...entry.features)
    } else {
      flatEntries.push(entry)
    }
  }

  const statusSnapshot: Record<string, string> = {}
  for (const fe of flatEntries) {
    const f = db.prepare('SELECT sections FROM features WHERE id = ?').get(fe.featureId) as
      | { sections: string }
      | undefined
    if (!f) continue
    const secs: { key: string }[] = JSON.parse(f.sections || '[]')
    for (const s of secs) {
      const docId = `${fe.featureId}/${s.key}`
      const doc = db.prepare('SELECT status FROM documents WHERE id = ?').get(docId) as
        | { status: string }
        | undefined
      statusSnapshot[docId] = doc?.status || 'draft'
    }
  }

  // 3. 组装完整手册（跳过审核过滤，包含全部文档）
  const fullManual = assembleManual(SEED_CATALOG_ID, { approvedOnly: false })
  if (!fullManual) {
    log.warn({ catalogId: SEED_CATALOG_ID }, '组装种子手册失败，跳过自动发布')
    return
  }

  // 4. 计算版本号（与发布接口逻辑一致）
  const prevVer = db
    .prepare(
      'SELECT version_major, version_minor, features_snapshot FROM catalog_versions WHERE catalog_id = ? ORDER BY version_major DESC, version_minor DESC LIMIT 1',
    )
    .get(SEED_CATALOG_ID) as
    | { version_major: number; version_minor: number; features_snapshot: string }
    | undefined

  let major: number
  let minor: number
  if (prevVer) {
    if (prevVer.features_snapshot !== catalogMeta.features) {
      major = prevVer.version_major + 1
      minor = 0
    } else {
      major = prevVer.version_major
      minor = prevVer.version_minor + 1
    }
  } else {
    major = 1
    minor = 0
  }

  // 5. 插入 catalog_versions
  const versionId = uuid().slice(0, 8)
  const versionLabel = `v${major}.${minor}`

  db.prepare(`
    INSERT INTO catalog_versions
      (id, catalog_id, version_major, version_minor, title, features_snapshot,
       change_notes, markdown, status_snapshot, visibility, features_json,
       headings_json, publish_scope)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId,
    SEED_CATALOG_ID,
    major,
    minor,
    fullManual.catalog.title,
    catalogMeta.features,
    '自动发布种子数据版本',
    fullManual.markdown,
    JSON.stringify(statusSnapshot),
    'public',
    JSON.stringify(fullManual.features),
    JSON.stringify(fullManual.headings),
    'all',
  )

  log.info({ versionLabel, versionId }, '种子数据版本已创建')

  // 6. 构建静态站点
  try {
    const outDir = await buildStaticSite(SEED_CATALOG_ID, versionLabel)
    log.info({ versionLabel, outDir }, '种子数据静态站点构建完成')
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      '种子数据静态站点构建失败（版本已创建，可手动从 UI 重新构建）',
    )
  }

  // 7. 记录审计
  recordAudit({
    userId: 'system',
    username: 'system',
    action: 'catalog.publish',
    targetType: 'catalog',
    targetId: SEED_CATALOG_ID,
    detail: {
      versionMajor: major,
      versionMinor: minor,
      title: catalogMeta.title,
      visibility: 'public',
      approvedOnly: false,
      source: 'seed',
    },
  })
}

/**
 * 检查并应用种子数据
 * @param force 为 true 时跳过版本检查，强制重新导入
 */
export async function seedManualIfNeeded(force = false): Promise<void> {
  const log = getLogger()

  // 版本检查（force 模式跳过）
  const currentVersion = getCurrentSeedVersion()
  if (!force && currentVersion >= SEED_VERSION) {
    return
  }

  const isFresh = currentVersion === 0
  log.info({ isFresh, currentVersion, targetVersion: SEED_VERSION }, '开始种子平台操作手册数据')

  // 构建种子 ZIP
  const { zipBuffer } = await buildSeedZip('default')

  // 写入临时文件（import-service 需要文件路径）
  const importDir = config.importDir
  if (!fs.existsSync(importDir)) {
    fs.mkdirSync(importDir, { recursive: true })
  }
  const zipPath = path.join(importDir, `_seed_manual_v${SEED_VERSION}.zip`)
  fs.writeFileSync(zipPath, zipBuffer)

  try {
    if (force || !isFresh) {
      // 强制模式或版本更新：分析差异 → 全部 overwrite
      const diff = await analyzeImport(zipPath, 'default')
      const strategies = {
        categories: mapOverwriteAll(diff.categories.conflicted),
        features: mapOverwriteAll(diff.features.conflicted),
        catalogs: mapOverwriteAll(diff.catalogs.conflicted),
        documents: await buildDocumentStrategies(),
      }
      const result = await applyImport(zipPath, 'default', {
        strategies,
        documentStatus: config.isProduction ? 'approved' : 'in_progress',
      })
      log.info({ result }, '种子数据更新完成')
    } else {
      // 全新安装：空策略即可（全部是新实体，无障碍）
      const result = await applyImport(zipPath, 'default', {
        strategies: { categories: {}, features: {}, catalogs: {}, documents: {} },
        documentStatus: config.isProduction ? 'approved' : 'in_progress',
      })
      log.info({ result }, '种子数据导入完成')
    }

    // 自动发布种子版本 + 构建静态站点
    await publishSeedVersion()

    // 记录种子版本
    setCurrentSeedVersion(SEED_VERSION)
    log.info({ version: SEED_VERSION }, '种子数据版本已记录')
  } finally {
    // 清理临时文件
    try {
      fs.unlinkSync(zipPath)
    } catch {
      /* ignore */
    }
  }
}
