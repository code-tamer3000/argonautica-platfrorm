// Тонкая обёртка над fetch: Bearer-токен, авто-рефреш на 401 (с ротацией), парсинг.
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokens'
import type { TokenPair } from './types'

export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
    this.detail = detail
  }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function rawRequest(path: string, init: RequestInit, auth: boolean): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (auth) {
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(path, { ...init, headers })
}

let refreshing: Promise<boolean> | null = null

async function doRefresh(): Promise<boolean> {
  const rt = getRefreshToken()
  if (!rt) return false
  const res = await rawRequest(
    '/api/auth/refresh',
    { method: 'POST', body: JSON.stringify({ refresh_token: rt }) },
    false,
  )
  if (!res.ok) return false
  const pair = (await res.json()) as TokenPair
  setTokens(pair)
  return true
}

function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = doRefresh()
    void refreshing.finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

export interface ApiOptions {
  auth?: boolean
}

export async function api<T>(path: string, init: RequestInit = {}, opts: ApiOptions = {}): Promise<T> {
  const auth = opts.auth ?? true
  let res = await rawRequest(path, init, auth)

  if (res.status === 401 && auth) {
    const ok = await tryRefresh()
    if (ok) {
      res = await rawRequest(path, init, auth)
    } else {
      clearTokens()
      onUnauthorized?.()
    }
  }

  if (!res.ok) {
    const body = await parseBody(res)
    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? (body as { detail: unknown }).detail
        : res.statusText
    throw new ApiError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail))
  }

  return (await parseBody(res)) as T
}

const jsonBody = (body?: unknown): string | undefined =>
  body !== undefined ? JSON.stringify(body) : undefined

export const http = {
  get: <T>(path: string): Promise<T> => api<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    api<T>(path, { method: 'POST', body: jsonBody(body) }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    api<T>(path, { method: 'PATCH', body: jsonBody(body) }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    api<T>(path, { method: 'PUT', body: jsonBody(body) }),
  del: <T>(path: string): Promise<T> => api<T>(path, { method: 'DELETE' }),
}
