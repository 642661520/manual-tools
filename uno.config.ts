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
  },
})
