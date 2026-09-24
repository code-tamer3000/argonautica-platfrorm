// Тонкая обёртка над IndexedDB (без сторонних зависимостей — не тянем idb в образ).
// Одна база `argonautica`, несколько object-store'ов key→value. Используется для:
//   - outbox   — очередь исходящих сообщений, переживающая офлайн/перезагрузку
//   - drafts   — черновики композера по комнатам
//   - querycache — persist кэша TanStack Query (мгновенный первый рендер)
// Всё изолировано по-стору; каждый вызов открывает соединение лениво и кэширует его.

const DB_NAME = 'argonautica'
// v2: добавлены cabinOutbox/cabinDrafts. v3: outboxBlobs — байты вложений
// (аудио/файлы) отправляемого сообщения, чтобы превью в ленте не пропадало после
// перезагрузки, пока сообщение ещё в очереди (presigned-URL к тому моменту протух
// бы). v4: playlistOffline — скачанные вручную байты треков плейлиста для
// офлайн-прослушивания (ARG-145), отдельно от outboxBlobs — это входящие
// (скачанные), а не исходящие данные, и живут дольше одной отправки. v5: authUser —
// последний успешный профиль из /api/auth/me (ARG-146), чтобы холодный офлайн-старт
// мог отрисовать авторизованное состояние без сети вместо вечного спиннера. Бампаем
// версию, чтобы onupgradeneeded создал новые сторы у пользователей с уже
// существующей базой.
const DB_VERSION = 5

// Именa стора держим в одном месте, чтобы onupgradeneeded создал ровно их.
export const STORE_OUTBOX = 'outbox'
export const STORE_DRAFTS = 'drafts'
export const STORE_QUERYCACHE = 'querycache'
// Очередь исходящих записей Каюты и черновики её форм (аналогично чату, но по
// подразделам вместо комнат) — см. lib/cabinOutbox.ts и lib/cabinDrafts.ts.
export const STORE_CABIN_OUTBOX = 'cabinOutbox'
export const STORE_CABIN_DRAFTS = 'cabinDrafts'
// Blob-байты вложений сообщений из outbox: ключ `${clientId}:${assetId}` → Blob.
// Держим отдельно от самого outbox-item, чтобы гидрация очереди (idbGetAll по
// STORE_OUTBOX) не тащила мегабайты медиа в память без нужды.
export const STORE_OUTBOX_BLOBS = 'outboxBlobs'
// Скачанные для офлайна байты треков плейлиста: ключ media_asset_id → Blob.
// Один трек может встречаться в нескольких плейлистах — храним по asset_id,
// не по playlist_id, чтобы не скачивать один и тот же файл дважды.
export const STORE_PLAYLIST_OFFLINE = 'playlistOffline'
// Последний успешный профиль (`UserOut` из GET /api/auth/me): единственная
// запись под фиксированным ключом. См. lib/authUserCache.ts.
export const STORE_AUTH_USER = 'authUser'
const STORES = [
  STORE_OUTBOX,
  STORE_DRAFTS,
  STORE_QUERYCACHE,
  STORE_CABIN_OUTBOX,
  STORE_CABIN_DRAFTS,
  STORE_OUTBOX_BLOBS,
  STORE_PLAYLIST_OFFLINE,
  STORE_AUTH_USER,
] as const

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    // В приватном режиме/старых браузерах IndexedDB может быть недоступен —
    // тогда весь offline-слой работает как no-op (см. safeguards в вызовах).
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
  // Если открытие упало — не кэшируем отказ навсегда, дадим шанс повторить.
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      }),
  )
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(key)).catch(() => undefined)
}

export function idbSet(store: string, key: IDBValidKey, value: unknown): Promise<void> {
  return tx<IDBValidKey>(store, 'readwrite', (s) => s.put(value, key))
    .then(() => undefined)
    .catch(() => undefined)
}

export function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  return tx<undefined>(store, 'readwrite', (s) => s.delete(key))
    .then(() => undefined)
    .catch(() => undefined)
}

export function idbClear(store: string): Promise<void> {
  return tx<undefined>(store, 'readwrite', (s) => s.clear())
    .then(() => undefined)
    .catch(() => undefined)
}

// Все записи стора как [key, value] пары (нужно outbox'у, чтобы поднять очередь при старте).
export function idbGetAll<T>(store: string): Promise<Array<{ key: IDBValidKey; value: T }>> {
  return openDb()
    .then(
      (db) =>
        new Promise<Array<{ key: IDBValidKey; value: T }>>((resolve, reject) => {
          const t = db.transaction(store, 'readonly')
          const s = t.objectStore(store)
          const out: Array<{ key: IDBValidKey; value: T }> = []
          const req = s.openCursor()
          req.onsuccess = () => {
            const cur = req.result
            if (cur) {
              out.push({ key: cur.key, value: cur.value as T })
              cur.continue()
            } else {
              resolve(out)
            }
          }
          req.onerror = () => reject(req.error)
        }),
    )
    .catch(() => [])
}
