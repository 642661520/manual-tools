import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['server/__tests__/**/*.test.ts', 'shared/__tests__/**/*.test.ts'],
    testTimeout: 10000,
    // E2E 测试共享 DB，必须顺序执行
    sequence: { concurrent: false },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: './coverage/server',
      include: ['server/**/*.ts', 'shared/**/*.ts'],
      exclude: [
        'server/__tests__/**',
        'server/services/site-builder/script.js',
        'server/services/site-builder/search.js',
      ],
      thresholds: {
        statements: 35,
        branches: 22,
        functions: 35,
        lines: 36,
      },
    },
  },
})
