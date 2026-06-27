import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Node.js 脚本（healthcheck, scripts）
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    ignores: [
      'dist/',
      'data/',
      'node_modules/',
      'server/db/migrations/',
      'server/services/site-builder/script.js',
      'server/services/site-builder/search.js',
      '**/*.d.ts',
      'uno.config.ts',
      'vite.config.ts',
    ],
  },
)
