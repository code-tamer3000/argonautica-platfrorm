import type { QueryClient } from '@tanstack/react-query'
import type { AttachmentOut, MessageOut } from '../lib/types'
import { messagesKey, type MessagesData } from './messages'

const has = (data: MessagesData, id: number): boolean =>
  data.pages.some((p) => p.some((m) => m.id === id))

// Новое сообщение — в начало newest-first страницы [0]. Дедуп по id (своё придёт и по WS).
export function appendMessage(qc: QueryClient, roomId: number, msg: MessageOut): void {
  qc.setQueryData<MessagesData>(messagesKey(roomId), (old) => {
    if (!old || old.pages.length === 0) return old
    if (has(old, msg.id)) return old
    const pages = old.pages.slice()
    pages[0] = [msg, ...pages[0]]
    return { ...old, pages }
  })
}

export function replaceMessage(qc: QueryClient, roomId: number, msg: MessageOut): void {
  qc.setQueryData<MessagesData>(messagesKey(roomId), (old) =>
    old ? { ...old, pages: old.pages.map((p) => p.map((m) => (m.id === msg.id ? msg : m))) } : old,
  )
}

export function removeMessage(qc: QueryClient, roomId: number, id: number): void {
  qc.setQueryData<MessagesData>(messagesKey(roomId), (old) =>
    old ? { ...old, pages: old.pages.map((p) => p.filter((m) => m.id !== id)) } : old,
  )
}

// Подменить одно вложение в сообщении по asset_id — прилетает по WS attachment.updated,
// когда серверный транскод видео готов/провалился. Меняем только совпавшее вложение
// (свежий url/thumb/transcode_status), сообщение и остальные вложения не трогаем.
export function updateAttachment(
  qc: QueryClient,
  roomId: number,
  messageId: number,
  attachment: AttachmentOut,
): void {
  const swap = (m: MessageOut): MessageOut => {
    if (m.id !== messageId) return m
    const attachments = m.attachments.map((a) =>
      a.asset_id === attachment.asset_id ? attachment : a,
    )
    return { ...m, attachments }
  }
  qc.setQueryData<MessagesData>(messagesKey(roomId), (old) =>
    old ? { ...old, pages: old.pages.map((p) => p.map(swap)) } : old,
  )
}

// --- Outbox: оптимистичные сообщения (см. lib/outbox.ts) ---

// Вставить оптимистичное сообщение в начало newest-first страницы [0].
// Если ленты ещё нет в кэше (комната не открывалась) — тихо пропускаем: когда
// пользователь откроет комнату, useMessages подтянет реальную историю, а воркер
// к тому моменту уже отправит сообщение.
export function insertOptimistic(qc: QueryClient, roomId: number, msg: MessageOut): void {
  qc.setQueryData<MessagesData>(messagesKey(roomId), (old) => {
    if (!old || old.pages.length === 0) return old
    if (has(old, msg.id)) return old
    const pages = old.pages.slice()
    pages[0] = [msg, ...pages[0]]
    return { ...old, pages }
  })
}

// Поменять статус доставки оптимистичного сообщения (pending ⇄ failed).
export function markOptimistic(
  qc: QueryClient,
  roomId: number,
  tempId: number,
  status: 'pending' | 'failed',
): void {
  qc.setQueryData<MessagesData>(messagesKey(roomId), (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((p) =>
            p.map((m) =>
              m.id === tempId && m._outbox
                ? { ...m, _outbox: { ...m._outbox, status } }
                : m,
            ),
          ),
        }
      : old,
  )
}

// Обновить долю заливки вложений оптимистичного сообщения (0..1). Пишем в _outbox,
// пузырь рисует полосу. Дёргается воркером outbox по ходу PUT в MinIO.
export function markUploadProgress(
  qc: QueryClient,
  roomId: number,
  tempId: number,
  fraction: number,
): void {
  qc.setQueryData<MessagesData>(messagesKey(roomId), (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((p) =>
            p.map((m) =>
              m.id === tempId && m._outbox
                ? { ...m, _outbox: { ...m._outbox, uploadProgress: fraction } }
                : m,
            ),
          ),
        }
      : old,
  )
}

// Заменить temp-сообщение реальным: убрать temp по tempId, добавить настоящее
// (дедуп на случай, если WS уже успел доставить message.new).
export function resolveOptimistic(
  qc: QueryClient,
  roomId: number,
  tempId: number,
  real: MessageOut,
): void {
  qc.setQueryData<MessagesData>(messagesKey(roomId), (old) => {
    if (!old) return old
    const alreadyReal = has(old, real.id)
    const pages = old.pages.map((p) =>
      p.flatMap((m) => {
        if (m.id === tempId) return alreadyReal ? [] : [real]
        return [m]
      }),
    )
    return { ...old, pages }
  })
}

// Ответ в тред: денормализованный счётчик на корне в ленте (root не приходит в событии).
export function bumpReplyCount(qc: QueryClient, roomId: number, rootId: number, at: string): void {
  qc.setQueryData<MessagesData>(messagesKey(roomId), (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((p) =>
            p.map((m) =>
              m.id === rootId
                ? { ...m, reply_count: m.reply_count + 1, last_reply_at: at }
                : m,
            ),
          ),
        }
      : old,
  )
}
