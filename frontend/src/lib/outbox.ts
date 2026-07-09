// Outbox: очередь исходящих сообщений, переживающая падение сети и перезагрузку.
//
// Проблема, которую решаем: при `http.post` на плохой сети мутация фейлится, а
// набранный текст уже пропал из композера — сообщение теряется бесследно. Теперь
// каждое отправляемое сообщение сперва ложится в IndexedDB и сразу показывается в
// ленте как «отправляется». Фоновый воркер шлёт его на сервер с ретраями; при
// офлайне ждёт события `online`. Успех → temp-сообщение заменяется настоящим.
//
// Ключевые инварианты:
//   - temp-id отрицательный (BIGSERIAL всегда > 0), поэтому не конфликтует с
//     реальными id и с дедупом appendMessage.
//   - порядок: temp-id монотонно убывает по времени постановки, чтобы новые
//     оптимистичные сообщения оказывались ниже в ленте (лента newest-last).
//   - очередь строго последовательна на комнату — сохраняем порядок отправки.
import { http, ApiError } from './apiClient'
import { idbDelete, idbGetAll, idbSet, STORE_OUTBOX } from './idb'
import type { MessageOut } from './types'
import type { SendBody } from '../api/messages'

export interface OutboxItem {
  clientId: string
  roomId: number
  body: SendBody
  senderId: number
  createdAt: string
  // Снимок вложений для оптимистичного показа (presigned-URL уже есть у ассета).
  attachments: MessageOut['attachments']
  tempId: number
  attempts: number
}

type Mutator = (item: OutboxItem) => void
type Resolver = (item: OutboxItem, real: MessageOut) => void
type Remover = (roomId: number, tempId: number) => void
type StatusMark = (roomId: number, tempId: number, status: 'pending' | 'failed') => void

// Колбэки в кэш Query внедряются из useRealtime (там есть qc). Держим их модульно,
// чтобы воркер мог работать вне React-дерева.
let onEnqueue: Mutator | null = null
let onResolve: Resolver | null = null
let onDrop: Remover | null = null
let onStatus: StatusMark | null = null

let seq = 0
// Уникальный, но убывающий во времени temp-id: минус (время + счётчик).
function nextTempId(): number {
  seq += 1
  return -(Date.now() * 1000 + (seq % 1000))
}

function clientId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `c${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Очередь в памяти (source of truth — IndexedDB; это её зеркало для воркера).
const queue: OutboxItem[] = []
let draining = false

export function configureOutbox(cbs: {
  enqueue: Mutator
  resolve: Resolver
  drop: Remover
  status: StatusMark
}): void {
  onEnqueue = cbs.enqueue
  onResolve = cbs.resolve
  onDrop = cbs.drop
  onStatus = cbs.status
}

// Собрать оптимистичный MessageOut из поставленного в очередь item'а.
export function optimisticMessage(item: OutboxItem): MessageOut {
  return {
    id: item.tempId,
    room_id: item.roomId,
    sender_id: item.senderId,
    content: item.body.content ?? null,
    sticker_id: item.body.sticker_id ?? null,
    thread_root_id: item.body.reply_to_message_id != null ? item.body.reply_to_message_id : null,
    forwarded_from_sender_id: null,
    reply_count: 0,
    last_reply_at: null,
    created_at: item.createdAt,
    edited_at: null,
    attachment_ids: item.body.attachment_ids ?? [],
    attachments: item.attachments,
    _outbox: { clientId: item.clientId, status: 'pending' },
  }
}

// Поставить сообщение в очередь. Возвращает clientId. Оптимистичное сообщение
// сразу уходит в кэш через onEnqueue. Тред-ответы (reply_to_message_id) в ленту
// не кладём — их обрабатывает отдельный путь; для них outbox не используем.
export function enqueue(
  roomId: number,
  body: SendBody,
  senderId: number,
  attachments: MessageOut['attachments'] = [],
): string {
  const item: OutboxItem = {
    clientId: clientId(),
    roomId,
    body,
    senderId,
    createdAt: new Date().toISOString(),
    attachments,
    tempId: nextTempId(),
    attempts: 0,
  }
  queue.push(item)
  void idbSet(STORE_OUTBOX, item.clientId, item)
  onEnqueue?.(item)
  void drain()
  return item.clientId
}

// Поднять очередь из IndexedDB при старте (сообщения, не ушедшие в прошлой сессии).
export async function hydrateOutbox(): Promise<OutboxItem[]> {
  const rows = await idbGetAll<OutboxItem>(STORE_OUTBOX)
  const items = rows
    .map((r) => r.value)
    .filter((v): v is OutboxItem => !!v && typeof v.clientId === 'string')
    // Сохраняем порядок постановки (по убыванию |tempId|, т.е. по времени).
    .sort((a, b) => b.tempId - a.tempId)
  for (const it of items) {
    // При восстановлении считаем статус pending — воркер попробует снова.
    queue.push(it)
  }
  return items
}

// Ручной повтор для «зависшего» (failed) сообщения — например по кнопке.
export function retry(clientId: string): void {
  const item = queue.find((q) => q.clientId === clientId)
  if (!item) return
  onStatus?.(item.roomId, item.tempId, 'pending')
  void drain()
}

// Удалить сообщение из очереди (пользователь передумал слать зависшее).
export function discard(clientId: string): void {
  const idx = queue.findIndex((q) => q.clientId === clientId)
  if (idx === -1) return
  const [item] = queue.splice(idx, 1)
  void idbDelete(STORE_OUTBOX, item.clientId)
  onDrop?.(item.roomId, item.tempId)
}

// Есть ли что-то незавершённое (для индикатора связи/бейджа).
export function pendingCount(): number {
  return queue.length
}

// Форсировать проталкивание очереди (сеть вернулась / реконнект WS).
export function flush(): void {
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
        const real = await http.post<MessageOut>(`/api/rooms/${item.roomId}/messages`, item.body)
        // Успех: убрать из очереди/IndexedDB и заменить temp реальным сообщением.
        queue.shift()
        void idbDelete(STORE_OUTBOX, item.clientId)
        onResolve?.(item, real)
      } catch (err) {
        item.attempts += 1
        void idbSet(STORE_OUTBOX, item.clientId, item)
        // Валидные 4xx (кроме 429) не ретраим бесконечно — это не сетевая беда,
        // а отклонённое сообщение; помечаем failed и оставляем на ручное действие.
        const status = err instanceof ApiError ? err.status : 0
        const permanent = status >= 400 && status < 500 && status !== 429 && status !== 408
        onStatus?.(item.roomId, item.tempId, 'failed')
        if (permanent) {
          // Стоп по этому сообщению — снимаем блок очереди, оставляя его failed
          // в начале. Ждём ручного retry/discard, но не морозим следующие.
          break
        }
        // Сетевая/временная ошибка: ждём backoff и пробуем снова этот же item.
        const delay = BACKOFF[Math.min(item.attempts - 1, BACKOFF.length - 1)]
        await sleep(delay)
        onStatus?.(item.roomId, item.tempId, 'pending')
      }
    }
  } finally {
    draining = false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
