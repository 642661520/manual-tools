import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    rules: {
      // 组件规范
      'vue/component-name-in-template-casing': 'error',
      'vue/no-undef-components': [
        'error',
        {
          ignorePatterns: ['router-view', 'router-link'],
        },
      ],
      'vue/multi-word-component-names': [
        'error',
        {
          ignores: ['Paginator', 'index'],
        },
      ],
      // 声明规范
      'vue/define-emits-declaration': 'error',
      'vue/define-props-declaration': 'error',
      'vue/prefer-single-event-payload': 'warn',
    },
  },
  {
    // Vue 文件：vue-eslint-parser 处理模板，tseslint.parser 处理 <script>
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaFeatures: { jsx: true },
        extraFileExtensions: ['.vue'],
      },
      globals: {
        // 浏览器 API
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        // 浏览器类型
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        Node: 'readonly',
        DragEvent: 'readonly',
        MessageEvent: 'readonly',
        BeforeUnloadEvent: 'readonly',
        IntersectionObserver: 'readonly',
        FileReader: 'readonly',
        crypto: 'readonly',
        console: 'readonly',
      },
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
  eslintConfigPrettier,
)
