// Persist кэша TanStack Query в IndexedDB — «бутстрап»: при следующем заходе
// комнаты/сообщения/профили рисуются мгновенно из кэша, а сеть догоняет фоном.
// Без сторонних пакетов: сериализуем нужные запросы сами.
//
// Кэшируем ТОЛЬКО стабильные, неприватные срезы: список комнат, пользователей,
// стикеры, ленты сообщений. Не персистим presigned-URL с коротким TTL как
// единственный источник — они в attachments лишь для быстрого показа, реальный
// путь всё равно перезапросит. Токены/секреты в кэш Query не попадают.
import type { QueryClient } from '@tanstack/react-query'
import { idbGet, idbSet, STORE_QUERYCACHE } from './idb'

const CACHE_KEY = 'v1'
// Не поднимаем протухший кэш: если снимку больше суток — игнорируем.
const MAX_AGE_MS = 24 * 60 * 60 * 1000

// Какие запросы персистим — по первому сегменту queryKey.
const PERSIST_KEYS = new Set(['rooms', 'users', 'stickers', 'stickerpacks', 'messages'])

interface Snapshot {
  savedAt: number
  queries: Array<{ key: unknown; state: unknown }>
}

function shouldPersist(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0]
  return typeof head === 'string' && PERSIST_KEYS.has(head)
}

// Восстановить кэш из IndexedDB ДО первого рендера (в main.tsx перед render).
export async function restoreQueryCache(qc: QueryClient): Promise<void> {
  const snap = await idbGet<Snapshot>(STORE_QUERYCACHE, CACHE_KEY)
  if (!snap || Date.now() - snap.savedAt > MAX_AGE_MS) return
  for (const { key, state } of snap.queries) {
    if (!Array.isArray(key)) continue
    // Данные считаем сразу устаревшими (dataUpdatedAt=0) — они рисуются мгновенно,
    // но помечены stale, поэтому первый фокус/маунт триггерит фоновый рефетч.
    const s = state as { data?: unknown }
    if (s?.data === undefined) continue
    qc.setQueryData(key, s.data, { updatedAt: 0 })
  }
}

// Подписка на изменения кэша с дебаунсом — пишем снимок в IndexedDB.
export function persistQueryCache(qc: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const dump = () => {
    const queries = qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.status === 'success' && shouldPersist(q.queryKey))
      .map((q) => ({ key: q.queryKey, state: { data: q.state.data } }))
    const snap: Snapshot = { savedAt: Date.now(), queries }
    void idbSet(STORE_QUERYCACHE, CACHE_KEY, snap)
  }

  const unsub = qc.getQueryCache().subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(dump, 1500)
  })

  return () => {
    if (timer) clearTimeout(timer)
    unsub()
  }
}
