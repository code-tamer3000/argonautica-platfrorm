// Кэш последнего успешного профиля (/api/auth/me) в IndexedDB — переживает
// перезапуск процесса офлайн (ARG-146). Без TTL: живёт до логаута, см.
// features/auth/api.ts::logout. Один ключ — одна запись, профиль не история.
import { idbDelete, idbGet, idbSet, STORE_AUTH_USER } from './idb'
import type { UserOut } from './types'

const KEY = 'v1'

export const getCachedUser = (): Promise<UserOut | undefined> => idbGet<UserOut>(STORE_AUTH_USER, KEY)

export const setCachedUser = (user: UserOut): Promise<void> => idbSet(STORE_AUTH_USER, KEY, user)

export const clearCachedUser = (): Promise<void> => idbDelete(STORE_AUTH_USER, KEY)
