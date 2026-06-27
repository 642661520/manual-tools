/**
 * 集中配置模块
 * 统一读取环境变量，提供默认值，导出为类型安全对象
 * 替换各文件中散落的 process.env.X
 */
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

  // JWT
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),

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

  // 缓存
  cacheDir: env('CACHE_DIR', join(process.cwd(), 'data/cache')),
  remoteCacheTtlDays: envInt('REMOTE_CACHE_TTL_DAYS', 7),
  exportCacheTtlDays: envInt('EXPORT_CACHE_TTL_DAYS', 30),
  remoteCacheMaxFileMb: envInt('REMOTE_CACHE_MAX_FILE_MB', 50),
} as const