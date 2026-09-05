import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  insertOptimistic,
  markOptimistic,
  markUploadProgress,
  resolveOptimistic,
  removeMessage,
} from '../api/cache'
import {
  configureOutbox,
  flush,
  hydrateOutbox,
  optimisticMessage,
  pendingForRoom,
  type OutboxItem,
} from '../lib/outbox'
import { wsClient } from '../lib/wsClient'
import { useUiStore } from '../stores/ui'

// Инициализация outbox'а: связывает воркер (вне React) с кэшем Query и запускает
// незавершённые сообщения из прошлой сессии. Монтируется один раз в корне
// приложения (AppShell) под авторизованным пользователем.
export function useOutbox(): void {
  const qc = useQueryClient()

  useEffect(() => {
    configureOutbox({
      enqueue: (item: OutboxItem) => {
        insertOptimistic(qc, item.roomId, optimisticMessage(item))
      },
      // Успех: заменяем temp-сообщение настоящим (resolveOptimistic дедупит, если
      // WS уже успел доставить своё message.new).
      resolve: (item, real) => {
        resolveOptimistic(qc, item.roomId, item.tempId, real)
        if (item.journal) {
          // Снимаем заряд раздела, только если он всё ещё стоит на ЭТОМ разделе —
          // за время в очереди (офлайн/ретраи) человек мог перезарядить другой.
          const pending = useUiStore.getState().pendingJournal
          if (pending?.roomId === item.roomId && pending.category === item.journal.category) {
            useUiStore.getState().setPendingJournal(null)
          }
          void qc.invalidateQueries({ queryKey: ['journal-days', item.roomId] })
        }
      },
      drop: (roomId, tempId) => removeMessage(qc, roomId, tempId),
      status: (roomId, tempId, status) => markOptimistic(qc, roomId, tempId, status),
      progress: (roomId, tempId, fraction) =>
        markUploadProgress(qc, roomId, tempId, fraction),
    })

    // Поднять очередь прошлой сессии и показать её сообщения оптимистично.
    void hydrateOutbox().then((items) => {
      for (const item of items) {
        insertOptimistic(qc, item.roomId, optimisticMessage(item))
      }
      flush()
    })
  }, [qc])

  // Сеть вернулась / WS переподключился — протолкнуть очередь немедленно.
  useEffect(() => {
    const onOnline = () => flush()
    window.addEventListener('online', onOnline)
    const off = wsClient.onStatus((s) => {
      if (s === 'open') flush()
    })
    return () => {
      window.removeEventListener('online', onOnline)
      off()
    }
  }, [])

  // Оптимистичные пузыри живут только как ручная запись в кэше (setQueryData из
  // insertOptimistic) — их не знает сам запрос. Любой НАСТОЯЩИЙ (не наш же ручной)
  // успешный фетч ленты комнаты — фоновый рефетч по фокусу/реконнекту, повторное
  // открытие комнаты и т.п. — целиком перезаписывает данные ответом сервера, который
  // ещё не в курсе про сообщение в очереди, и пузырь пропадает из ленты, хотя само
  // сообщение живо и продолжает пытаться уйти. Чиним точечно: после каждого такого
  // фетча заново вставляем в кэш всё, что для этой комнаты ещё сидит в очереди.
  useEffect(() => {
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) {
        return
      }
      const key = event.query.queryKey
      if (key[0] !== 'messages' || typeof key[1] !== 'number') return
      const roomId = key[1]
      for (const item of pendingForRoom(roomId)) {
        insertOptimistic(qc, roomId, optimisticMessage(item))
      }
    })
  }, [qc])
}
