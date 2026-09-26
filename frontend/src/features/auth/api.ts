import { api, http } from '../../lib/apiClient'
import { clearAttachmentPreviewCache } from '../../lib/attachmentPreviewCache'
import { clearCachedUser } from '../../lib/authUserCache'
import { clearMediaCache } from '../../lib/mediaCache'
import { clearTokens, getRefreshToken, setTokens } from '../../lib/tokens'
import type { TokenPair, UserOut } from '../../lib/types'
import { useOfflinePlaylists } from '../../stores/offlinePlaylists'

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
  // Медиа приватное, устройство может быть общим: рантайм-кэш картинок сносим,
  // иначе после выхода они остаются доступны из Cache Storage. Best-effort —
  // clearMediaCache сам глотает отсутствие Cache API и не роняет логаут.
  await clearMediaCache()
  // Скачанные для офлайна треки плейлистов (ARG-145) — та же логика: приватное
  // медиа, устройство общее, не переживает логаут.
  await useOfflinePlaylists.getState().clearAll()
  // Byte-level кэш превью вложений чата (ARG-149) — та же логика: приватное медиа,
  // устройство общее. Best-effort — не роняет логаут при недоступном IndexedDB.
  await clearAttachmentPreviewCache()
  // Закэшированный профиль (ARG-146) — без TTL, живёт до логаута; тот же общий
  // девайс, что и выше, поэтому чужой профиль не должен пережить выход.
  await clearCachedUser()
}

export const changePassword = (current_password: string, new_password: string): Promise<null> =>
  api<null>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password, new_password }),
  })
