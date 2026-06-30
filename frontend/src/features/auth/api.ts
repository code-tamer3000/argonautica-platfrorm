import { api, http } from '../../lib/apiClient'
import { clearTokens, getRefreshToken, setTokens } from '../../lib/tokens'
import type { TokenPair, UserOut } from '../../lib/types'

export const getMe = (): Promise<UserOut> => http.get<UserOut>('/api/auth/me')

export async function login(username: string, password: string): Promise<UserOut> {
  const pair = await api<TokenPair>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ username, password }) },
    { auth: false },
  )
  setTokens(pair)
  return getMe()
}

export async function logout(): Promise<void> {
  const rt = getRefreshToken()
  try {
    if (rt) {
      await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: rt }) }, { auth: false })
    }
  } catch {
    // logout идемпотентен — игнорируем сетевые ошибки
  }
  clearTokens()
}

export const changePassword = (current_password: string, new_password: string): Promise<null> =>
  api<null>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password, new_password }),
  })
