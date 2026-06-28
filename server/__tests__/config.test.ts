import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('config — 环境变量解析', () => {
  it('envInt 非数字值时使用 fallback', async () => {
    process.env.EXPORT_CACHE_TTL_DAYS = 'not-a-number'
    const { config } = await import('../config.js')
    expect(config.exportCacheTtlDays).toBe(30)
  })

  it('envInt 正常解析数字', async () => {
    process.env.EXPORT_CACHE_TTL_DAYS = '45'
    const { config } = await import('../config.js')
    expect(config.exportCacheTtlDays).toBe(45)
  })
})

describe('config — JWT 密钥', () => {
  it('生产环境未设置 JWT_SECRET 时报错', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    delete process.env.JWT_SECRET

    try {
      await expect(import('../config.js')).rejects.toThrow('[FATAL]')
    } finally {
      process.env.NODE_ENV = prevNodeEnv
    }
  })
})
