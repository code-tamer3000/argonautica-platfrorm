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

// Запрос не долетел до сервера (offline, таймаут, DNS): про токен/сессию ничего
// не известно. НЕ путать с ответом сервера — сессию по этому трогать нельзя.
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('network error')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

export function isNetworkError(err: unknown): err is NetworkError {
  return err instanceof NetworkError
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
  try {
    return await fetch(path, { ...init, headers })
  } catch (err) {
    // fetch реджектится только когда запрос не долетел (сеть/CORS/abort),
    // а не на HTTP-ошибках — это всегда сетевой сбой.
    throw new NetworkError(err)
  }
}

let refreshing: Promise<boolean> | null = null

// true — access обновлён; false — сервер отклонил refresh (токен мёртв);
// NetworkError — до сервера не достучались (сессию трогать нельзя).
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
    // tryRefresh может реджектнуться NetworkError — тогда не разлогиниваем,
    // а пробрасываем сетевую ошибку наверх (сессия могла остаться живой).
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
