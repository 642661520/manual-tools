// ============================================================
// CLI 脚本：强制重新导入种子数据
// 用法: pnpm seed
// ============================================================

import '../../lib/win-encoding.js'
import { initDatabase } from '../index.js'
import { seedManualIfNeeded } from './index.js'

// 初始化数据库（创建表、默认项目、管理员等）
initDatabase()

// 强制重新种子（跳过版本检查，覆盖已有数据）
await seedManualIfNeeded(true)

console.log('[seed] 种子数据导入完成')

// 退出进程（better-sqlite3 需要显式关闭）
process.exit(0)
