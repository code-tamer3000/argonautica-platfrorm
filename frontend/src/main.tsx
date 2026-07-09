import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './features/auth/AuthContext'
import { setupViewport } from './lib/viewport'
import { persistQueryCache, restoreQueryCache } from './lib/queryPersist'
import { applyThemeAtBoot } from './stores/theme'
import './styles/tokens.css'
import './styles/global.css'

// Применяем сохранённую тему до первого рендера — иначе светлая тема мигнёт тёмным.
applyThemeAtBoot()

// Держим высоту приложения равной видимой области (с учётом клавиатуры на мобиле).
setupViewport()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      // Возврат на вкладку → фоновый рефетч. Раньше было выключено, из-за чего
      // после переключения вкладок лента показывала устаревший кэш и «теряла»
      // сообщения, пришедшие пока вкладка спала. Теперь фокус освежает данные;
      // моргания нет — старые данные видны, пока приходят свежие.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

// Бутстрап: сперва восстанавливаем кэш из IndexedDB (мгновенный первый рендер из
// прошлого визита), затем монтируем приложение и включаем фоновый persist. Чтение
// IndexedDB — считаные миллисекунды; если оно упадёт, рендерим как обычно.
async function boot() {
  await restoreQueryCache(queryClient).catch(() => {})
  persistQueryCache(queryClient)

  createRoot(root!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void boot()
