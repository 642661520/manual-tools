/**
 * 集中配置模块
 * 统一读取环境变量，提供默认值，导出为类型安全对象
 * 替换各文件中散落的 process.env.X
 */
import { randomBytes } from 'crypto'
import { hostname } from 'os'
import { join } from 'path'

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw !== undefined) {
    const n = parseInt(raw)
    if (!isNaN(n)) return n
  }
  return fallback
}

/** 读环境变量，空字符串视为未设置 */
function envOpt(key: string): string | undefined {
  const raw = process.env[key]
  if (raw !== undefined && raw !== '') return raw
  return undefined
}

/** 获取 JWT 密钥：生产环境必须设置环境变量，开发环境随机生成并打印警告 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (secret && secret !== 'dev-secret-change-me') return secret
  if (env('NODE_ENV', '') === 'production') {
    throw new Error('[FATAL] 生产环境必须设置 JWT_SECRET 环境变量，且不能使用默认值')
  }
  const generated = randomBytes(32).toString('hex')
  console.warn('[WARN] 使用临时 JWT 密钥（仅开发环境）')
  return generated
}

export const config = {
  // 服务
  port: envInt('PORT', 3000),
  nodeEnv: env('NODE_ENV', 'development'),
  isProduction: env('NODE_ENV', '') === 'production',
  appBaseUrl: env('APP_BASE_URL', 'http://localhost:5173'),

  // CORS
  corsOrigin: env('CORS_ORIGIN', ''),

  // 数据库
  databasePath: env('DATABASE_PATH', './data/manual.db'),
  dbJournalMode: env('DB_JOURNAL_MODE', 'wal'),

  // JWT（生产环境随机生成，开发环境通过 process.env.JWT_SECRET 覆盖）
  jwtSecret: getJwtSecret(),

  // 系统管理员种子
  adminUsername: env('ADMIN_USERNAME', 'admin'),
  adminPassword: env('ADMIN_PASSWORD', 'admin123'),

  // 目录
  uploadDir: env('UPLOAD_DIR', join(process.cwd(), 'data/uploads')),
  exportDir: env('EXPORT_DIR', join(process.cwd(), 'data/exports')),
  importDir: env('IMPORT_DIR', join(process.cwd(), 'data/imports')),

  // 上传限制 (MB)
  uploadMaxSize: envInt('UPLOAD_MAX_SIZE', 10),
  videoMaxSize: envInt('VIDEO_MAX_SIZE', 100),

  // Y.js 快照
  yjsSnapshotThreshold: envInt('YJS_SNAPSHOT_UPDATE_THRESHOLD', 500),

  // 飞书
  feishuHost: env('FEISHU_HOST', 'https://open.feishu.cn'),
  feishuAppId: env('FEISHU_APP_ID', ''),
  feishuAppSecret: env('FEISHU_APP_SECRET', ''),
  feishuRedirectUri: env('FEISHU_REDIRECT_URI', ''),
  adminOpenIds: env('ADMIN_OPEN_IDS', env('PM_OPEN_IDS', '')),

  // PDF 导出
  pdfFontRegular: env('PDF_FONT_REGULAR', ''),
  pdfFontBold: env('PDF_FONT_BOLD', ''),
  puppeteerExecutablePath: env('PUPPETEER_EXECUTABLE_PATH', ''),

  // AI 辅助写作（OpenAI 兼容接口）
  aiBaseUrl: env('AI_BASE_URL', ''),
  aiApiKey: env('AI_API_KEY', ''),
  aiModel: env('AI_MODEL', 'gpt-4o-mini'),

  // 缓存
  cacheDir: env('CACHE_DIR', join(process.cwd(), 'data/cache')),
  remoteCacheTtlDays: envInt('REMOTE_CACHE_TTL_DAYS', 7),
  exportCacheTtlDays: envInt('EXPORT_CACHE_TTL_DAYS', 30),
  remoteCacheMaxFileMb: envInt('REMOTE_CACHE_MAX_FILE_MB', 50),

  // 日志
  logLevel: env('LOG_LEVEL', env('NODE_ENV', '') === 'production' ? 'info' : 'debug'),
  logFileLevel: envOpt('LOG_FILE_LEVEL'),
  logFilePath: env('LOG_FILE_PATH', join(process.cwd(), 'data/logs/app.log')),
  logHostname: env('LOG_HOSTNAME', hostname()),
  logRetainDays: envInt('LOG_RETAIN_DAYS', 30),
  logMaxSizeMb: envInt('LOG_MAX_SIZE_MB', 10),
} as const