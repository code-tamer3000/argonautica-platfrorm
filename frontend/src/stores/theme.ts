// Тема оформления: тёмная (по умолчанию) / светлая. Выбор хранится в localStorage
// и применяется как атрибут data-theme на <html> — CSS-переменные в tokens.css
// переопределяются под [data-theme="light"]. Инициализируем ДО первого рендера
// (см. applyThemeAtBoot в main.tsx), чтобы не мигало тёмным при загрузке.
import { create } from 'zustand'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'arg-theme'

export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* localStorage недоступен (приватный режим) — молча берём тёмную */
  }
  return 'dark'
}

function applyTheme(theme: Theme) {
  const el = document.documentElement
  if (theme === 'light') el.setAttribute('data-theme', 'light')
  else el.removeAttribute('data-theme')
  el.style.colorScheme = theme
}

// Применить сохранённую тему до рендера (в main.tsx). Синхронизирует и стор.
export function applyThemeAtBoot() {
  const theme = readStoredTheme()
  applyTheme(theme)
}

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),
  setTheme: (t) => {
    applyTheme(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* игнорируем — тема всё равно применена к DOM на эту сессию */
    }
    set({ theme: t })
  },
  toggle: () => get().setTheme(get().theme === 'light' ? 'dark' : 'light'),
}))
