import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { setUnauthorizedHandler } from '../../lib/apiClient'
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
  useEffect(() => {
    let cancelled = false
    if (!hasRefreshToken()) {
      setStatus('anon')
      return
    }
    authApi
      .getMe()
      .then((me) => {
        if (!cancelled) {
          setUser(me)
          setStatus('authed')
        }
      })
      .catch(() => {
        if (!cancelled) reset()
      })
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
