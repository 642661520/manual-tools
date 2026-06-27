/**
 * 统一日志模块
 * 全项目（server / routes / services）统一使用 pino 结构化日志
 *
 * 双路输出：
 *   stdout — 开发 pino-pretty 彩色 / 生产 JSON
 *   文件  — pino-roll 按天 + 按大小轮转，自动清理过期日志
 *
 * 用法：
 *   import { getLogger } from '../lib/logger.js'
 *   const log = getLogger()
 *   log.info({ userId: 'xxx' }, 'something happened')
 *   log.error({ err }, 'something failed')
 */
import { pino, type Logger } from 'pino'
import { config } from '../config.js'

let _logger: Logger | null = null

/** 获取全局 logger 实例（懒加载单例） */
export function getLogger(): Logger {
  if (!_logger) {
    _logger = createLogger()
  }
  return _logger
}

function buildFileTarget() {
  const fileLevel = config.logFileLevel ?? config.logLevel
  // 去掉 .log 后缀，pino-roll 会自动拼接日期和扩展名
  const logBase = config.logFilePath.replace(/\.\w+$/, '')

  return {
    target: 'pino-roll',
    level: fileLevel,
    options: {
      file: logBase,
      frequency: 'daily' as const,
      size: `${config.logMaxSizeMb}m`,
      limit: { count: config.logRetainDays },
      extension: '.log',
      dateFormat: 'yyyy-MM-dd',
      mkdir: true,
    },
  }
}

function buildStdoutTarget() {
  if (config.isProduction) {
    return {
      target: 'pino/file',
      level: config.logLevel,
      options: { destination: 1 },
    }
  }
  return {
    target: 'pino-pretty',
    level: config.logLevel,
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
  }
}

function createLogger(): Logger {
  const baseOpts = config.isProduction
    ? { base: { pid: process.pid, hostname: config.logHostname } }
    : {}

  return pino({
    level: config.logLevel,
    ...baseOpts,
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: {
      targets: [buildStdoutTarget(), buildFileTarget()],
    },
  })
}

/** 创建携带绑定上下文的子 logger（用于请求级别，自动注入 requestId/userId 等） */
export function createChildLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings)
}
