import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Dev: проксируем REST и WS на бэкенд (uvicorn на :8000), чтобы не упираться в CORS
// и одинаково ходить на /api и /ws как в проде за nginx.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Аргонавтика',
        short_name: 'Аргонавтика',
        description: 'База знаний и реалтайм-чат',
        lang: 'ru',
        theme_color: '#0B100E',
        background_color: '#0B100E',
        display: 'standalone',
        // Иконки добавим в фазе PWA (Стадия 12, фаза 5).
        icons: [],
      },
      workbox: {
        // Оболочку прекэшируем, API/WS — никогда.
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
