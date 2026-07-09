import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Dev: проксируем REST и WS на бэкенд (uvicorn на :8000), чтобы не упираться в CORS
// и одинаково ходить на /api и /ws как в проде за nginx.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest: свой src/sw.ts (нужен обработчик `push`/`notificationclick`
      // для нативных уведомлений), в который Workbox инжектит precache-манифест.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 'prompt' + ручная регистрация (useRegisterSW) — чтобы показать ненавязчивый
      // баннер «есть обновление», а не тихо/принудительно перезагружать вкладку.
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        // Оболочку прекэшируем, API/WS — никогда (в самом sw.ts).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      manifest: {
        name: 'Аргонавтика',
        short_name: 'Аргонавтика',
        description: 'База знаний и реалтайм-чат',
        lang: 'ru',
        theme_color: '#0B100E',
        background_color: '#0B100E',
        display: 'standalone',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: (() => {
      // BACKEND_URL=http://localhost:8000   — локальный бэкенд (dev.sh)
      // BACKEND_URL=https://my.domain.ru   — прод-бэкенд (разработка против прода)
      // По умолчанию — localhost:8000
      const http = process.env.BACKEND_URL ?? 'http://localhost:8000'
      const ws = http.replace(/^http/, 'ws') // http→ws, https→wss
      return {
        '/api': { target: http, changeOrigin: true },
        '/ws':  { target: ws,   ws: true },
      }
    })(),
  },
})
