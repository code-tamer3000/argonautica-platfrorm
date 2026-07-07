import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './features/auth/AuthContext'
import { setupViewport } from './lib/viewport'
import { applyThemeAtBoot } from './stores/theme'
import './styles/tokens.css'
import './styles/global.css'

// Применяем сохранённую тему до первого рендера — иначе светлая тема мигнёт тёмным.
applyThemeAtBoot()

// Держим высоту приложения равной видимой области (с учётом клавиатуры на мобиле).
setupViewport()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
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
