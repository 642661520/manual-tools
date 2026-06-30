import { defineConfig, presetUno, presetIcons, presetTypography } from 'unocss'

export default defineConfig({
  presets: [
    presetUno({ dark: 'class' }),
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
    // ---- 语义色映射 ----
    // 背景
    ['bg-base', { 'background-color': 'var(--c-bg-base)' }],
    ['bg-surface', { 'background-color': 'var(--c-bg-surface)' }],
    ['bg-hover', { 'background-color': 'var(--c-bg-hover)' }],
    ['bg-active', { 'background-color': 'var(--c-bg-active)' }],
    // 文字
    ['text-primary', { color: 'var(--c-text-primary)' }],
    ['text-secondary', { color: 'var(--c-text-secondary)' }],
    ['text-muted', { color: 'var(--c-text-muted)' }],
    // 边框
    ['border-default', { 'border-color': 'var(--c-border)' }],
    ['border-default-l', { 'border-left-color': 'var(--c-border)' }],
    ['border-default-b', { 'border-bottom-color': 'var(--c-border)' }],
    ['border-default-t', { 'border-top-color': 'var(--c-border)' }],
    ['border-light', { 'border-color': 'var(--c-border-light)' }],
    ['border-input', { 'border-color': 'var(--c-border-input)' }],
    // 分割线（用作 hr 或 divide 的增强）
    ['divide-default', { '--un-divide-opacity': '1', 'border-color': 'var(--c-border-light)' }],
    // 主题色
    ['color-accent', { color: 'var(--c-accent)' }],
    ['bg-accent', { 'background-color': 'var(--c-accent-bg)' }],
    // 语义色
    ['color-danger', { color: 'var(--c-danger)' }],
    ['color-success', { color: 'var(--c-success)' }],
    ['bg-danger', { 'background-color': 'var(--c-danger-bg)' }],
    ['bg-warning', { 'background-color': 'var(--c-warning-bg)' }],
    ['bg-success', { 'background-color': 'var(--c-success-bg)' }],
    // ring 颜色
    ['ring-accent', { '--un-ring-color': 'var(--c-accent)' }],
  ],
  shortcuts: {
    btn: 'px-4 py-2 rounded-lg cursor-pointer inline-flex items-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none',
    'btn-primary': 'btn bg-[var(--c-accent)] text-white hover:bg-[var(--c-accent-hover)]',
    'btn-secondary': 'btn bg-[var(--c-border)] text-secondary hover:bg-[var(--c-border-input)]',
    'btn-danger': 'btn bg-[var(--c-danger)] text-white hover:bg-[var(--c-danger-hover)]',
    card: 'bg-surface rounded-xl shadow-sm border border-default p-6',
    input:
      'w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent bg-surface text-primary placeholder:text-muted',
    textarea:
      'w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent resize-y min-h-[80px] bg-surface text-primary placeholder:text-muted',
    label: 'text-sm font-medium text-secondary mb-1 block',

    // 响应式布局 shortcuts
    'r-container': 'w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
    'sidebar-layout': 'flex-1 flex overflow-hidden',
    'sidebar-panel':
      'flex-shrink-0 overflow-y-auto bg-surface border-r border-default transition-all duration-300',
    'sidebar-content': 'flex-1 overflow-y-auto',

    // 编辑器工具栏
    'editor-toolbar-base':
      'flex items-center gap-0.5 sm:gap-1 px-2 sm:px-4 py-1.5 sm:py-2 border-b border-default bg-surface flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-visible scrollbar-none',

    // 弹窗 shortcuts
    'dialog-base':
      'bg-surface rounded-xl shadow-xl w-full mx-3 sm:mx-auto max-w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[90vh] flex flex-col',
    'dialog-header':
      'px-4 sm:px-6 py-3 sm:py-4 border-b border-default flex items-center justify-between flex-shrink-0',
    'dialog-body': 'p-4 sm:p-6 overflow-y-auto',
    'dialog-footer': 'px-4 sm:px-6 py-3 sm:py-4 border-t border-default',
    'dialog-actions': 'flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3',
  },
})
