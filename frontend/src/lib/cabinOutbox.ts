// Outbox для записей «Каюты»: очередь исходящих create/update, переживающая
// плохую сеть и перезагрузку. Прямой аналог lib/outbox.ts для сообщений чата,
// но проще: без вложений и без строгого порядка на комнату — каждая запись
// самостоятельна.
//
// Проблема, которую решаем: пользователь заполнил длинную форму, нажал
// «Добавить», сеть моргнула — http.post упал, форма закрыта, данные потеряны.
// Теперь запись сперва ложится в IndexedDB и сразу показывается в списке как
// «сохраняется». Фоновый воркер шлёт её с ретраями; при офлайне ждёт `online`.
// Успех → временная запись заменяется настоящей с сервера.
//
// Инварианты:
//   - tempId отрицательный (реальные id из БД всегда > 0) — не конфликтует.
//   - для update реальный id известен сразу (realId), tempId не нужен —
//     оптимистично показываем новые данные поверх существующей записи.
import { http, ApiError } from './apiClient'
import { idbDelete, idbGetAll, idbSet, STORE_CABIN_OUTBOX } from './idb'
import type { CabinData, CabinEntryOut, CabinKind } from './types'

export interface CabinOutboxItem {
  clientId: string
  kind: CabinKind
  data: CabinData
  createdAt: string
  // Для create — undefined (сервер выдаст id); для update — id существующей записи.
  realId?: number
  tempId: number
  attempts: number
}

type Enqueue = (item: CabinOutboxItem) => void
type Resolve = (item: CabinOutboxItem, real: CabinEntryOut) => void
type StatusMark = (item: CabinOutboxItem, status: 'pending' | 'failed') => void
type Drop = (item: CabinOutboxItem) => void

// Колбэки в кэш Query внедряются из компонента (там есть queryClient).
let onEnqueue: Enqueue | null = null
let onResolve: Resolve | null = null
let onStatus: StatusMark | null = null
let onDrop: Drop | null = null

let seq = 0
function nextTempId(): number {
  seq += 1
  return -(Date.now() * 1000 + (seq % 1000))
}

function clientId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `c${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const queue: CabinOutboxItem[] = []
let draining = false

export function configureCabinOutbox(cbs: {
  enqueue: Enqueue
  resolve: Resolve
  status: StatusMark
  drop: Drop
}): void {
  onEnqueue = cbs.enqueue
  onResolve = cbs.resolve
  onStatus = cbs.status
  onDrop = cbs.drop
}

// Оптимистичная запись из поставленного в очередь item'а. Для update берём
// realId как id (данные обновляются на месте), для create — временный tempId.
export function optimisticCabinEntry(item: CabinOutboxItem): CabinEntryOut {
  const id = item.realId ?? item.tempId
  return {
    id,
    kind: item.kind,
    data: item.data,
    created_at: item.createdAt,
    updated_at: item.createdAt,
    _outbox: { clientId: item.clientId, status: 'pending' },
  }
}

// Поставить create/update в очередь. Возвращает поставленный item (компонент
// использует его id для оптимистичного показа). Оптимистичная запись уходит в
// кэш через onEnqueue.
export function enqueueCabin(kind: CabinKind, data: CabinData, realId?: number): CabinOutboxItem {
  const item: CabinOutboxItem = {
    clientId: clientId(),
    kind,
    data,
    createdAt: new Date().toISOString(),
    realId,
    tempId: nextTempId(),
    attempts: 0,
  }
  queue.push(item)
  void idbSet(STORE_CABIN_OUTBOX, item.clientId, item)
  onEnqueue?.(item)
  void drain()
  return item
}

// Поднять очередь из IndexedDB при старте (записи, не ушедшие в прошлой сессии).
export async function hydrateCabinOutbox(): Promise<CabinOutboxItem[]> {
  const rows = await idbGetAll<CabinOutboxItem>(STORE_CABIN_OUTBOX)
  const items = rows
    .map((r) => r.value)
    .filter((v): v is CabinOutboxItem => !!v && typeof v.clientId === 'string')
    .sort((a, b) => b.tempId - a.tempId)
  for (const it of items) queue.push(it)
  return items
}

export function retryCabin(clientId: string): void {
  const item = queue.find((q) => q.clientId === clientId)
  if (!item) return
  onStatus?.(item, 'pending')
  void drain()
}

export function discardCabin(clientId: string): void {
  const idx = queue.findIndex((q) => q.clientId === clientId)
  if (idx === -1) return
  const [item] = queue.splice(idx, 1)
  void idbDelete(STORE_CABIN_OUTBOX, item.clientId)
  onDrop?.(item)
}

export function flushCabin(): void {
  void drain()
}

const BACKOFF = [1000, 2000, 5000, 10_000, 15_000]

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length > 0) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) break
      const item = queue[0]
      try {
        const real =
          item.realId != null
            ? await http.put<CabinEntryOut>(`/api/cabin/${item.kind}/${item.realId}`, {
                data: item.data,
              })
            : await http.post<CabinEntryOut>(`/api/cabin/${item.kind}`, { data: item.data })
        queue.shift()
        void idbDelete(STORE_CABIN_OUTBOX, item.clientId)
        onResolve?.(item, real)
      } catch (err) {
        item.attempts += 1
        void idbSet(STORE_CABIN_OUTBOX, item.clientId, item)
        const status = err instanceof ApiError ? err.status : 0
        const permanent = status >= 400 && status < 500 && status !== 429 && status !== 408
        onStatus?.(item, 'failed')
        if (permanent) break
        const delay = BACKOFF[Math.min(item.attempts - 1, BACKOFF.length - 1)]
        await sleep(delay)
        onStatus?.(item, 'pending')
      }
    }
  } finally {
    draining = false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
