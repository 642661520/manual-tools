// ============================================================
// 种子编排逻辑
// 版本检测 → 构建 ZIP → 调用 import-service 导入/更新
// ============================================================

import fs from 'fs'
import path from 'path'
import { getDb } from '../index.js'
import { config } from '../../config.js'
import { getLogger } from '../../lib/logger.js'
import { analyzeImport, applyImport } from '../../services/import-service.js'
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
