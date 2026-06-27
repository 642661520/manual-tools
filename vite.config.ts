/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    UnoCSS(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/v1': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
      '/docs': 'http://localhost:5000',
      '/ws': {
        target: 'ws://localhost:5000',
        ws: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts', 'server/__tests__/**/*.test.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['server/**/*.ts', 'src/**/*.ts', 'src/**/*.vue'],
      exclude: [
        'server/__tests__/**',
        'src/__tests__/**',
        'server/services/site-builder/script.js',
        'server/services/site-builder/search.js',
        'src/router.ts',
      ],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 40,
        lines: 50,
      },
    },
  },
})
