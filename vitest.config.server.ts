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
        statements: 22,
        branches: 18,
        functions: 29,
        lines: 23,
      },
    },
  },
})
