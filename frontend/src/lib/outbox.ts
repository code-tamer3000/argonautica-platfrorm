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
import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbSet,
  STORE_OUTBOX,
  STORE_OUTBOX_BLOBS,
} from './idb'
import { runPendingUpload, type PendingUpload } from './mediaUpload'
import type { AttachmentOut, MediaAssetOut, MediaKind, MessageOut, MessageRefOut } from './types'
import type { SendBody } from '../api/messages'

// Вложение, которое ещё НЕ залито в MinIO (сообщение поставлено в очередь офлайн).
// Несёт метаданные для отложенной заливки (kind/mime/размеры/длительность) и временный
// отрицательный tempAssetId, под которым его байты лежат в STORE_OUTBOX_BLOBS. Воркер
// зальёт его перед отправкой сообщения (см. resolvePendingUploads).
export interface PendingUploadRef {
  tempAssetId: number
  contentType: string
  kind: MediaKind
  width?: number
  height?: number
  duration?: number
  hasPoster?: boolean
}

export interface OutboxItem {
  clientId: string
  roomId: number
  body: SendBody
  senderId: number
  createdAt: string
  // Снимок вложений для оптимистичного показа. URL здесь — локальный `blob:` (см.
  // blobAssetIds), а НЕ presigned: presigned протух бы к моменту повторной отправки
  // после долгого офлайна, а blob-URL живёт, пока жива вкладка, и заново куётся из
  // IndexedDB при гидрации.
  attachments: MessageOut['attachments']
  // asset_id вложений, чьи байты лежат в STORE_OUTBOX_BLOBS (ключ `${clientId}:${id}`).
  // По ним при гидрации перевыпускаем blob-URL и чистим байты после отправки/отмены.
  blobAssetIds: number[]
  // Вложения, которые надо ЗАЛИТЬ перед отправкой сообщения (офлайн-путь: файл/голос
  // прикреплён без сети). Пусто у обычных сообщений, где ассеты уже в MinIO. Воркер
  // резолвит их в реальные asset_id и наполняет body.attachment_ids (см. drain).
  pendingUploads?: PendingUploadRef[]
  // Ссылка (материал/задача) для оптимистичного показа кнопки «Перейти к…» сразу.
  // title берём из пикера; сервер перерезолвит `ref` (title/available) на чтении.
  optimisticRef?: MessageRefOut
  tempId: number
  attempts: number
}

// Локальное вложение отправляемого сообщения: ассет (уже на сервере) + его байты,
// которые мы кладём в IndexedDB, чтобы превью пережило перезагрузку.
export interface LocalAttachment {
  asset: MediaAssetOut
  blob: Blob
}

function blobKey(clientId: string, assetId: number): string {
  return `${clientId}:${assetId}`
}

// Ключ байтов постера видео отложенной заливки (отдельно от самого файла).
function posterKey(clientId: string, tempAssetId: number): string {
  return `${clientId}:${tempAssetId}:poster`
}

let assetSeq = 0
// Временный отрицательный asset_id для оптимистичного вложения (реальные id > 0).
function nextTempAssetId(): number {
  assetSeq += 1
  return -(Date.now() * 1000 + (assetSeq % 1000))
}

// Снимок AttachmentOut из ассета + локального blob-URL (kind/размеры/длительность
// уже известны из media_assets — плеер сразу рисует правильную коробку).
function snapshotFromAsset(asset: MediaAssetOut, url: string): AttachmentOut {
  return {
    asset_id: asset.id,
    url,
    thumb_url: asset.kind === 'image' ? url : null,
    kind: asset.kind,
    mime_type: asset.mime_type,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
  }
}

// Снимок AttachmentOut для ещё не залитого вложения: kind/размеры/длительность из
// локально снятых метаданных, url — blob:-превью. asset_id временный (отрицательный).
function snapshotFromPending(pending: PendingUploadRef, url: string): AttachmentOut {
  return {
    asset_id: pending.tempAssetId,
    url,
    thumb_url: pending.kind === 'image' ? url : null,
    kind: pending.kind,
    mime_type: pending.contentType,
    size: 0,
    width: pending.width ?? null,
    height: pending.height ?? null,
    duration: pending.duration ?? null,
  }
}

type Mutator = (item: OutboxItem) => void
type Resolver = (item: OutboxItem, real: MessageOut) => void
type Remover = (roomId: number, tempId: number) => void
type StatusMark = (roomId: number, tempId: number, status: 'pending' | 'failed') => void
// Доля 0..1 заливки вложений сообщения в MinIO (общая по всем вложениям item'а).
type ProgressMark = (roomId: number, tempId: number, fraction: number) => void

// Колбэки в кэш Query внедряются из useRealtime (там есть qc). Держим их модульно,
// чтобы воркер мог работать вне React-дерева.
let onEnqueue: Mutator | null = null
let onResolve: Resolver | null = null
let onDrop: Remover | null = null
let onStatus: StatusMark | null = null
let onProgress: ProgressMark | null = null

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

// Живые blob:-URL по clientId — освобождаем их (revokeObjectURL) и удаляем байты из
// IndexedDB, когда сообщение отправилось/отменено, чтобы не течь памятью/местом.
const liveBlobUrls = new Map<string, string[]>()

function trackBlobUrl(clientId: string, url: string): void {
  const arr = liveBlobUrls.get(clientId) ?? []
  arr.push(url)
  liveBlobUrls.set(clientId, arr)
}

// Освободить blob:-URL и стереть сами байты вложений сообщения из IndexedDB.
function releaseBlobs(item: OutboxItem): void {
  const urls = liveBlobUrls.get(item.clientId)
  if (urls) {
    for (const u of urls) URL.revokeObjectURL(u)
    liveBlobUrls.delete(item.clientId)
  }
  for (const assetId of item.blobAssetIds) {
    void idbDelete(STORE_OUTBOX_BLOBS, blobKey(item.clientId, assetId))
  }
  for (const pu of item.pendingUploads ?? []) {
    void idbDelete(STORE_OUTBOX_BLOBS, blobKey(item.clientId, pu.tempAssetId))
    void idbDelete(STORE_OUTBOX_BLOBS, posterKey(item.clientId, pu.tempAssetId))
  }
}

export function configureOutbox(cbs: {
  enqueue: Mutator
  resolve: Resolver
  drop: Remover
  status: StatusMark
  progress: ProgressMark
}): void {
  onEnqueue = cbs.enqueue
  onResolve = cbs.resolve
  onDrop = cbs.drop
  onStatus = cbs.status
  onProgress = cbs.progress
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
    unread_reply_count: 0,
    last_reply_at: null,
    created_at: item.createdAt,
    edited_at: null,
    attachment_ids: item.body.attachment_ids ?? [],
    attachments: item.attachments,
    ref: item.optimisticRef ?? null,
    _outbox: { clientId: item.clientId, status: 'pending' },
  }
}

// Поставить сообщение в очередь. Возвращает clientId. Оптимистичное сообщение
// сразу уходит в кэш через onEnqueue. Тред-ответы (reply_to_message_id) в ленту
// не кладём — их обрабатывает отдельный путь; для них outbox не используем.
//
// `locals` — вложения (аудио/файлы), уже залитые в MinIO, чьи БАЙТЫ мы кэшируем в
// IndexedDB. Из них куём blob-URL для оптимистичного превью: оно так переживает
// перезагрузку, пока сообщение в очереди, и не зависит от протухания presigned-URL.
export function enqueue(
  roomId: number,
  body: SendBody,
  senderId: number,
  locals: LocalAttachment[] = [],
  optimisticRef?: MessageRefOut,
): string {
  const cid = clientId()
  const attachments: AttachmentOut[] = []
  const blobAssetIds: number[] = []
  for (const { asset, blob } of locals) {
    const url = URL.createObjectURL(blob)
    trackBlobUrl(cid, url)
    attachments.push(snapshotFromAsset(asset, url))
    blobAssetIds.push(asset.id)
    // Байты — в отдельный стор; переживут перезагрузку (см. hydrateOutbox).
    void idbSet(STORE_OUTBOX_BLOBS, blobKey(cid, asset.id), blob)
  }
  const item: OutboxItem = {
    clientId: cid,
    roomId,
    body,
    senderId,
    createdAt: new Date().toISOString(),
    attachments,
    blobAssetIds,
    optimisticRef,
    tempId: nextTempId(),
    attempts: 0,
  }
  queue.push(item)
  void idbSet(STORE_OUTBOX, item.clientId, item)
  onEnqueue?.(item)
  void drain()
  return item.clientId
}

// Поставить в очередь сообщение с вложениями, которые ЕЩЁ НЕ ЗАЛИТЫ (офлайн-путь:
// файл/голос прикреплён без сети). Байты кладём в IndexedDB, оптимистичное превью
// рисуем из blob:-URL. Воркер зальёт вложения (resolvePendingUploads) перед отправкой
// самого сообщения — так медиа переживает офлайн/перезагрузку так же, как текст.
export function enqueueMedia(
  roomId: number,
  body: SendBody,
  senderId: number,
  uploads: PendingUpload[],
  optimisticRef?: MessageRefOut,
): string {
  const cid = clientId()
  const attachments: AttachmentOut[] = []
  const pendingUploads: PendingUploadRef[] = []
  for (const pu of uploads) {
    const tempAssetId = nextTempAssetId()
    const url = URL.createObjectURL(pu.blob)
    trackBlobUrl(cid, url)
    const ref: PendingUploadRef = {
      tempAssetId,
      contentType: pu.contentType,
      kind: pu.kind,
      width: pu.width,
      height: pu.height,
      duration: pu.duration,
      hasPoster: !!pu.posterBlob,
    }
    pendingUploads.push(ref)
    attachments.push(snapshotFromPending(ref, url))
    // Байты файла + постера (если есть) — в отдельный стор; переживут перезагрузку.
    void idbSet(STORE_OUTBOX_BLOBS, blobKey(cid, tempAssetId), pu.blob)
    if (pu.posterBlob) void idbSet(STORE_OUTBOX_BLOBS, posterKey(cid, tempAssetId), pu.posterBlob)
  }
  const item: OutboxItem = {
    clientId: cid,
    roomId,
    body,
    senderId,
    createdAt: new Date().toISOString(),
    attachments,
    blobAssetIds: [],
    pendingUploads,
    optimisticRef,
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
// Для вложений с кэшированными байтами перевыпускаем blob:-URL (старые из прошлой
// сессии мертвы) и подставляем их в снимок attachments, чтобы превью нарисовалось.
export async function hydrateOutbox(): Promise<OutboxItem[]> {
  const rows = await idbGetAll<OutboxItem>(STORE_OUTBOX)
  const items = rows
    .map((r) => r.value)
    .filter((v): v is OutboxItem => !!v && typeof v.clientId === 'string')
    // Сохраняем порядок постановки (по убыванию |tempId|, т.е. по времени).
    .sort((a, b) => b.tempId - a.tempId)
  for (const it of items) {
    // Легаси-item'ы (до v3) поля blobAssetIds не имеют — подстрахуемся.
    if (!Array.isArray(it.blobAssetIds)) it.blobAssetIds = []
    await rehydrateBlobUrls(it)
    // При восстановлении считаем статус pending — воркер попробует снова.
    queue.push(it)
  }
  return items
}

// Перевыпустить blob:-URL для вложений item'а из байтов в IndexedDB и заменить ими
// протухшие URL прошлой сессии в снимке attachments (in place). Покрывает и уже
// залитые вложения (blobAssetIds), и ещё не залитые (pendingUploads).
async function rehydrateBlobUrls(item: OutboxItem): Promise<void> {
  const assetIds = [
    ...item.blobAssetIds,
    ...(item.pendingUploads ?? []).map((p) => p.tempAssetId),
  ]
  for (const assetId of assetIds) {
    const blob = await idbGet<Blob>(STORE_OUTBOX_BLOBS, blobKey(item.clientId, assetId))
    if (!blob) continue
    const url = URL.createObjectURL(blob)
    trackBlobUrl(item.clientId, url)
    const att = item.attachments.find((a) => a.asset_id === assetId)
    if (att) {
      att.url = url
      if (att.kind === 'image') att.thumb_url = url
    }
  }
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
  releaseBlobs(item)
  onDrop?.(item.roomId, item.tempId)
}

// Есть ли что-то незавершённое (для индикатора связи/бейджа).
export function pendingCount(): number {
  return queue.length
}

// Есть ли в очереди неотправленное сообщение этой комнаты. По нему WS-обработчик
// понимает, что своё message.new — это эхо ещё живущего оптимистичного сообщения
// (temp-id ≠ реальный, дедуп по id не сработает), и не рисует дубль. На других
// устройствах того же юзера очереди нет → там своё сообщение из WS покажется.
export function hasPending(roomId: number): boolean {
  return queue.some((q) => q.roomId === roomId)
}

// Форсировать проталкивание очереди (сеть вернулась / реконнект WS).
export function flush(): void {
  void drain()
}

const BACKOFF = [1000, 2000, 5000, 10_000, 15_000]

// Залить все ещё не залитые вложения item'а и наполнить body.attachment_ids реальными
// id ассетов. Каждый успешный ассет фиксируем в IndexedDB и убираем из pendingUploads,
// чтобы повтор после сбоя на следующем шаге не заливал уже загруженное дважды. Бросает
// при офлайне/ошибке — drain поймает и отправит item на backoff/ретрай.
async function resolvePendingUploads(item: OutboxItem): Promise<void> {
  // Общее число вложений к заливке (для честной доли по нескольким файлам). Считаем
  // один раз до цикла — pendingUploads по ходу укорачивается (shift).
  const total = item.pendingUploads?.length ?? 0
  let done = 0
  while (item.pendingUploads && item.pendingUploads.length > 0) {
    const ref = item.pendingUploads[0]
    const blob = await idbGet<Blob>(STORE_OUTBOX_BLOBS, blobKey(item.clientId, ref.tempAssetId))
    if (!blob) {
      // Байты пропали (например, приватный режим/чистка стораджа) — отбрасываем это
      // вложение, но сообщение не блокируем: отправим с тем, что осталось.
      item.pendingUploads.shift()
      done += 1
      continue
    }
    const posterBlob = ref.hasPoster
      ? await idbGet<Blob>(STORE_OUTBOX_BLOBS, posterKey(item.clientId, ref.tempAssetId))
      : undefined
    const pending: PendingUpload = {
      blob,
      contentType: ref.contentType,
      kind: ref.kind,
      width: ref.width,
      height: ref.height,
      duration: ref.duration,
      posterBlob: posterBlob ?? undefined,
    }
    // Прогресс заливки текущего файла → общая доля по сообщению (уже залитые + текущий).
    const asset = await runPendingUpload(pending, (f) => {
      if (total > 0) onProgress?.(item.roomId, item.tempId, (done + f) / total)
    })
    item.body.attachment_ids = [...(item.body.attachment_ids ?? []), asset.id]
    item.pendingUploads.shift()
    done += 1
    // Байты больше не нужны — ассет уже в MinIO.
    void idbDelete(STORE_OUTBOX_BLOBS, blobKey(item.clientId, ref.tempAssetId))
    void idbDelete(STORE_OUTBOX_BLOBS, posterKey(item.clientId, ref.tempAssetId))
    void idbSet(STORE_OUTBOX, item.clientId, item)
  }
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length > 0) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) break
      const item = queue[0]
      try {
        // Офлайн-медиа: сперва заливаем ещё не залитые вложения и наполняем
        // body.attachment_ids — только потом отправляем само сообщение.
        if (item.pendingUploads && item.pendingUploads.length > 0) {
          await resolvePendingUploads(item)
        }
        const real = await http.post<MessageOut>(`/api/rooms/${item.roomId}/messages`, item.body)
        // Успех: убрать из очереди/IndexedDB и заменить temp реальным сообщением
        // (у него уже presigned-URL с сервера).
        queue.shift()
        void idbDelete(STORE_OUTBOX, item.clientId)
        // ПОРЯДОК ВАЖЕН: сперва подменяем temp на real (presigned-URL), и только ПОТОМ
        // ревокаем blob:-URL оптимистичного превью. Иначе между revokeObjectURL и
        // перерисовкой на real остаётся кадр, где temp ещё показан, но его blob-URL уже
        // мёртв → вложение «пропадает» до обновления страницы (видео/фото исчезает).
        onResolve?.(item, real)
        releaseBlobs(item)
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
