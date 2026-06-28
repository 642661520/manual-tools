import { defineConfig, presetUno, presetIcons, presetTypography } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.4,
      warn: true,
      cdn: 'https://esm.sh/',
      extraProperties: {
        display: 'inline-block',
        'flex-shrink': '0',
        transform: 'translateY(-1px)',
      },
    }),
    presetTypography(),
  ],
  rules: [
    // 隐藏滚动条但保持可滚动
    [
      'scrollbar-none',
      {
        'scrollbar-width': 'none',
        '-ms-overflow-style': 'none',
      },
    ],
  ],
  shortcuts: {
    btn: 'px-4 py-2 rounded-lg cursor-pointer inline-flex items-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none',
    'btn-primary': 'btn bg-blue-600 text-white hover:bg-blue-700',
    'btn-secondary': 'btn bg-gray-200 text-gray-700 hover:bg-gray-300',
    'btn-danger': 'btn bg-red-600 text-white hover:bg-red-700',
    card: 'bg-white rounded-xl shadow-sm border border-gray-200 p-6',
    input:
      'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
    textarea:
      'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y min-h-[80px]',
    label: 'text-sm font-medium text-gray-700 mb-1 block',

    // 响应式布局 shortcuts
    'r-container': 'w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
    'sidebar-layout': 'flex-1 flex overflow-hidden',
    'sidebar-panel':
      'flex-shrink-0 overflow-y-auto bg-white border-r border-gray-200 transition-all duration-300',
    'sidebar-content': 'flex-1 overflow-y-auto',

    // 编辑器工具栏
    'editor-toolbar-base':
      'flex items-center gap-0.5 sm:gap-1 px-2 sm:px-4 py-1.5 sm:py-2 border-b border-gray-200 bg-white flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-visible scrollbar-none',

    // 弹窗 shortcuts
    'dialog-base':
      'bg-white rounded-xl shadow-xl w-full mx-3 sm:mx-auto max-w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[90vh] flex flex-col',
    'dialog-header':
      'px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0',
    'dialog-body': 'p-4 sm:p-6 overflow-y-auto',
    'dialog-footer': 'px-4 sm:px-6 py-3 sm:py-4 border-t border-gray-200',
    'dialog-actions': 'flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3',
  },
})
