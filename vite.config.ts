import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function normalizeBase(value?: string) {
  const trimmed = value?.trim() || '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}${trimmed === '/' ? '' : '/'}`
}

export default defineConfig(({ mode }) => {
  const base = normalizeBase(loadEnv(mode, '.', '').VITE_BASE_PATH)
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['pwa-192.svg', 'pwa-512.svg'],
        manifest: {
          name: '微光 · 寓言碎片学习', short_name: '微光学习',
          description: '一天读一点，用寓言理解一个真正重要的概念。',
          theme_color: '#f4efe5', background_color: '#f4efe5', display: 'standalone',
          start_url: base, scope: base, lang: 'zh-CN',
          icons: [
            { src: `${base}pwa-192.svg`, sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
            { src: `${base}pwa-512.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
          ]
        },
        workbox: { navigateFallback: `${base}index.html`, globPatterns: ['**/*.{js,css,html,svg,json}'], runtimeCaching: [] }
      })
    ]
  }
})
