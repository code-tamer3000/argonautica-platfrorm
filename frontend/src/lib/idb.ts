// Тонкая обёртка над IndexedDB (без сторонних зависимостей — не тянем idb в образ).
// Одна база `argonautica`, несколько object-store'ов key→value. Используется для:
//   - outbox   — очередь исходящих сообщений, переживающая офлайн/перезагрузку
//   - drafts   — черновики композера по комнатам
//   - querycache — persist кэша TanStack Query (мгновенный первый рендер)
// Всё изолировано по-стору; каждый вызов открывает соединение лениво и кэширует его.

const DB_NAME = 'argonautica'
const DB_VERSION = 1

// Именa стора держим в одном месте, чтобы onupgradeneeded создал ровно их.
export const STORE_OUTBOX = 'outbox'
export const STORE_DRAFTS = 'drafts'
export const STORE_QUERYCACHE = 'querycache'
const STORES = [STORE_OUTBOX, STORE_DRAFTS, STORE_QUERYCACHE] as const

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
