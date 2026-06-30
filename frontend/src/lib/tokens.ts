// Access — в памяти (не переживает перезагрузку), refresh — в localStorage.
// (SPEC предпочёл бы httpOnly-cookie + CSRF, но бэкенд отдаёт токены JSON — это вне scope.)
import type { TokenPair } from './types'

const REFRESH_KEY = 'arg.refresh'
let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

export function setTokens(pair: TokenPair): void {
  accessToken = pair.access_token
  localStorage.setItem(REFRESH_KEY, pair.refresh_token)
}

export function clearTokens(): void {
  accessToken = null
  localStorage.removeItem(REFRESH_KEY)
}

export function hasRefreshToken(): boolean {
  return getRefreshToken() !== null
}
