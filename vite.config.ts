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
  },
})
