import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isNetworkError, setUnauthorizedHandler } from '../../lib/apiClient'
import { hasRefreshToken } from '../../lib/tokens'
import type { UserOut } from '../../lib/types'
import * as authApi from './api'

type Status = 'loading' | 'anon' | 'authed'

interface AuthContextValue {
  status: Status
  user: UserOut | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
  setUser: (u: UserOut) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<UserOut | null>(null)

  const reset = useCallback(() => {
    setUser(null)
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
  //   • сетевая ошибка (плохой интернет) — про сессию ничего не известно, НЕ разлогиниваем:
  //     пускаем в приложение (refresh-токен есть) и ретраим /me в фоне, пока связь не вернётся.
  useEffect(() => {
    let cancelled = false
    if (!hasRefreshToken()) {
      setStatus('anon')
      return
    }

    async function bootstrap(): Promise<void> {
      while (!cancelled) {
        try {
          const me = await authApi.getMe()
          if (!cancelled) {
            setUser(me)
            setStatus('authed')
          }
          return
        } catch (err) {
          if (cancelled) return
          if (isNetworkError(err)) {
            // Сеть отвалилась: сессию НЕ сбрасываем (refresh-токен на месте).
            // Остаёмся в loading (спиннер, не логин) и повторяем /me с паузой,
            // пока связь не вернётся. AuthGuard требует user, поэтому 'authed'
            // без user всё равно показал бы логин — держим loading.
            await new Promise((r) => setTimeout(r, 5000))
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
    }
  }, [reset])

  const login = useCallback(async (username: string, password: string) => {
    const me = await authApi.login(username, password)
    setUser(me)
    setStatus('authed')
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    reset()
  }, [reset])

  const refreshMe = useCallback(async () => {
    const me = await authApi.getMe()
    setUser(me)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, refreshMe, setUser }),
    [status, user, login, logout, refreshMe],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
