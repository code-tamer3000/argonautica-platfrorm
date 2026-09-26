import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { isNetworkError, setUnauthorizedHandler } from '../../lib/apiClient'
import { getCachedUser, setCachedUser } from '../../lib/authUserCache'
import { hasRefreshToken } from '../../lib/tokens'
import type { UserOut } from '../../lib/types'
import * as authApi from './api'

// 'offline' — бутстрап упал сетевой ошибкой и кэша user нет вообще (первый
// офлайн-запуск либо кэш стёрт логаутом): явный экран «Нет связи», не спиннер.
type Status = 'loading' | 'anon' | 'authed' | 'offline'

interface AuthContextValue {
  status: Status
  user: UserOut | null
  // Сессия поднята из офлайн-кэша, свежими данными с сервера ещё не подтверждена
  // (см. bootstrap). Не влияет на права — те решает сервер на каждом запросе.
  stale: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
  retryBootstrap: () => void
  setUser: (u: UserOut) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const RETRY_DELAY_MS = 5000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<UserOut | null>(null)
  const [stale, setStale] = useState(false)
  const wakeRef = useRef<(() => void) | null>(null)

  const reset = useCallback(() => {
    setUser(null)
    setStale(false)
    setStatus('anon')
  }, [])

  // 401 без возможности рефреша → разлогин.
  useEffect(() => {
    setUnauthorizedHandler(reset)
  }, [reset])

  // Бутстрап: если есть refresh-токен, пробуем /me (apiClient сам поднимет access).
  // Важно различать причины провала /me:
  //   • сервер отклонил токен (401 → apiClient уже вызвал reset через onUnauthorized) —
  //     сессия мертва, показываем логин;
  //   • сетевая ошибка (плохой интернет/офлайн) — про сессию ничего не известно, НЕ
  //     разлогиниваем: если есть закэшированный user — пускаем в приложение из кэша
  //     (stale=true) и ретраим /me в фоне; если кэша нет — явный экран «Нет связи»
  //     вместо бесконечного спиннера (ARG-146).
  useEffect(() => {
    let cancelled = false
    if (!hasRefreshToken()) {
      setStatus('anon')
      return
    }

    async function bootstrap(): Promise<void> {
      let cachedChecked = false
      let cachedUser: UserOut | undefined
      while (!cancelled) {
        try {
          const me = await authApi.getMe()
          if (cancelled) return
          setUser(me)
          setStale(false)
          setStatus('authed')
          void setCachedUser(me)
          return
        } catch (err) {
          if (cancelled) return
          if (isNetworkError(err)) {
            if (!cachedChecked) {
              cachedUser = await getCachedUser()
              cachedChecked = true
              if (cancelled) return
            }
            if (cachedUser) {
              setUser(cachedUser)
              setStale(true)
              setStatus('authed')
            } else {
              setStatus('offline')
            }
            // Ждём паузу перед следующей попыткой, но retryBootstrap может
            // разбудить раньше (кнопка «Повторить» на офлайн-экране).
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, RETRY_DELAY_MS)
              wakeRef.current = () => {
                clearTimeout(t)
                resolve()
              }
            })
            wakeRef.current = null
            continue
          }
          // Любая не-сетевая ошибка: если это был 401, onUnauthorized уже
          // сбросил сессию; на всякий случай гарантируем anon-состояние.
          reset()
          return
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
      wakeRef.current?.()
    }
  }, [reset])

  const login = useCallback(async (username: string, password: string) => {
    const me = await authApi.login(username, password)
    setUser(me)
    setStale(false)
    setStatus('authed')
    void setCachedUser(me)
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    reset()
  }, [reset])

  const refreshMe = useCallback(async () => {
    const me = await authApi.getMe()
    setUser(me)
    setStale(false)
    void setCachedUser(me)
  }, [])

  const retryBootstrap = useCallback(() => {
    wakeRef.current?.()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, stale, login, logout, refreshMe, retryBootstrap, setUser }),
    [status, user, stale, login, logout, refreshMe, retryBootstrap],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
