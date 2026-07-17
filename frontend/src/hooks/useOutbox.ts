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
  type OutboxItem,
} from '../lib/outbox'
import { wsClient } from '../lib/wsClient'

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
      resolve: (item, real) => resolveOptimistic(qc, item.roomId, item.tempId, real),
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
}
