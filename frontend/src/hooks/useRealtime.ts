import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import {
  appendMessage,
  bumpReplyCount,
  removeMessage,
  replaceMessage,
  updateAttachment,
} from '../api/cache'
import { notificationsKey } from '../api/notifications'
import { pinsKey } from '../api/pins'
import { roomsKey, useRooms } from '../api/rooms'
import {
  submissionCommentsKey,
  taskKey,
  taskSubmissionsKey,
  tasksKey,
} from '../api/tasks'
import { threadKey } from '../api/threads'
import { useUsersMap } from '../api/users'
import { useAuth } from '../features/auth/AuthContext'
import { useOpenNotification } from '../features/app/useOpenNotification'
import { http } from '../lib/apiClient'
import { hasPending as outboxHasPending } from '../lib/outbox'
import { wsClient } from '../lib/wsClient'
import type { NotificationKind, NotificationListOut, RoomOut, WsEvent } from '../lib/types'
import { notify } from '../stores/toast'
import { useUiStore } from '../stores/ui'

const NOTIF_FALLBACK: Record<NotificationKind, string> = {
  dm: 'Новое сообщение',
  reply: 'Ответил(а) на ваше сообщение',
  news: 'Новый пост в новостях',
  mention: 'Вас упомянули',
  cabin_granted: 'Вам открыт доступ к разделу «Каюта»',
  admin: 'Уведомление от администрации',
}

function patchRooms(qc: QueryClient, fn: (rooms: RoomOut[]) => RoomOut[]): void {
  qc.setQueryData<RoomOut[]>(roomsKey, (old) => (old ? fn(old) : old))
}

const setUnread = (qc: QueryClient, roomId: number, n: number) =>
  patchRooms(qc, (rs) => rs.map((r) => (r.id === roomId ? { ...r, unread_count: n } : r)))

const incUnread = (qc: QueryClient, roomId: number) =>
  patchRooms(qc, (rs) => rs.map((r) => (r.id === roomId ? { ...r, unread_count: r.unread_count + 1 } : r)))

function bumpRoom(qc: QueryClient, roomId: number): void {
  patchRooms(qc, (rs) => {
    const idx = rs.findIndex((r) => r.id === roomId)
    if (idx <= 0) return rs
    const next = rs.slice()
    const [r] = next.splice(idx, 1)
    next.unshift(r)
    return next
  })
}

// Единая проводка WS-событий в кэш. Вызывается один раз в корне приложения.
export function useRealtime(): void {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data: rooms } = useRooms()
  const markTyping = useUiStore((s) => s.markTyping)
  const setOnline = useUiStore((s) => s.setOnline)
  const setDmPeer = useUiStore((s) => s.setDmPeer)
  const usersMap = useUsersMap()
  const openNotification = useOpenNotification()
  const meRef = useRef(user?.id ?? -1)
  meRef.current = user?.id ?? -1
  // Админ не выполняет задачи — ему не шлём тост-уведомления по задачам.
  const isAdminRef = useRef(user?.role === 'admin')
  isAdminRef.current = user?.role === 'admin'
  // Читаем актуальные значения из листенера, не пересоздавая подписку на каждый рендер.
  const usersRef = useRef(usersMap)
  usersRef.current = usersMap
  const openRef = useRef(openNotification)
  openRef.current = openNotification
  const subscribed = useRef<Set<number>>(new Set())

  // Подписка на все комнаты + заполняем dmPeers из peer_id, который отдаёт API.
  useEffect(() => {
    if (!rooms) return
    for (const r of rooms) {
      if (!subscribed.current.has(r.id)) {
        subscribed.current.add(r.id)
        wsClient.subscribe(r.id)
      }
      if (r.type === 'dm' && r.peer_id != null) {
        setDmPeer(r.id, r.peer_id)
      }
    }
  }, [rooms, setDmPeer])

  // Вкладку вернули из фона: пока она спала, мобильный браузер мог тихо оборвать
  // WS, а события — потеряться. Форсируем реконнект (переподписка + рефетч ленты
  // идут по onConnect ниже), чтобы догнать пропущенное и не «терять» сообщения.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') wsClient.reconnectNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // При каждом реконнекте: сбрасываем локальный трекер и рефетчим комнаты.
  // wsClient сам переподпишет уже известные комнаты в ws.onopen;
  // рефетч нужен чтобы подписаться на комнаты созданные пока WS был оффлайн.
  useEffect(() => {
    return wsClient.onConnect(() => {
      subscribed.current.clear()
      void qc.invalidateQueries({ queryKey: roomsKey })
      // Догнать сообщения, пришедшие пока сокет был оборван: рефетчим ленту
      // открытой комнаты (остальные освежатся при открытии — они и так stale).
      const active = useUiStore.getState().activeRoomId
      if (active != null) void qc.invalidateQueries({ queryKey: ['messages', active] })
    })
  }, [qc])

  // Снепшот онлайн-пользователей при загрузке, чтобы индикаторы не были пустыми.
  useEffect(() => {
    if (!user) return
    http.get<number[]>('/api/users/presence').then((online) => {
      for (const id of online) setOnline(id, true)
    }).catch(() => {})
  }, [user, setOnline])

  useEffect(() => {
    return wsClient.on((e: WsEvent) => {
      const me = meRef.current
      switch (e.type) {
        case 'message.new': {
          const msg = e.message
          if (msg.thread_root_id === null) {
            // Пропускаем WS-эхо, если это своё сообщение, а в очереди ещё живёт его
            // оптимистичный двойник (temp-id ≠ реальный → дедуп по id не сработает,
            // и на миг виден дубль: серое «отправляется…» + рядом уже не-серое, потом
            // схлопываются). Его вставит путь отправки (resolveOptimistic). На чужом
            // сообщении и на другом устройстве (очереди нет) — добавляем как обычно.
            if (!(msg.sender_id === me && outboxHasPending(msg.room_id))) {
              appendMessage(qc, msg.room_id, msg)
            }
          } else {
            // Ответ в тред: обновить счётчик на корне и открытый тред.
            bumpReplyCount(qc, msg.room_id, msg.thread_root_id, msg.created_at)
            qc.invalidateQueries({ queryKey: threadKey(msg.room_id, msg.thread_root_id) })
          }
          bumpRoom(qc, msg.room_id)
          const active = useUiStore.getState().activeRoomId
          if (msg.room_id === active) {
            setUnread(qc, msg.room_id, 0) // ChatPane отправит POST /read
          } else if (msg.sender_id !== me) {
            incUnread(qc, msg.room_id)
          }
          break
        }
        case 'message.edited':
          replaceMessage(qc, e.message.room_id, e.message)
          break
        case 'message.deleted':
          removeMessage(qc, e.room_id, e.message_id)
          break
        case 'attachment.updated':
          // Серверный транскод видео готов/провалился — меняем вложение по asset_id
          // в ленте. Тред-ветки держат вложения в своём запросе — обновляем и его
          // (сообщение может быть ответом в треде).
          updateAttachment(qc, e.room_id, e.message_id, e.attachment)
          qc.invalidateQueries({ queryKey: ['thread', e.room_id] })
          break
        case 'pin.added':
        case 'pin.removed':
          qc.invalidateQueries({ queryKey: pinsKey(e.room_id) })
          break
        case 'typing':
          if (e.user_id !== me) markTyping(e.room_id, e.user_id)
          break
        case 'presence':
          setOnline(e.user_id, e.status === 'online')
          break
        case 'notification.new': {
          const n = e.notification
          // Кэш колокольчика: добавить наверх + инкремент непрочитанных.
          qc.setQueryData<NotificationListOut>(notificationsKey, (old) =>
            old
              ? { items: [n, ...old.items].slice(0, 50), unread_count: old.unread_count + 1 }
              : { items: [n], unread_count: 1 },
          )
          // Всплывающий тост — только если пользователь не смотрит эту комнату сейчас
          // (иначе он и так видит сообщение — дублировать не нужно).
          if (n.room_id !== useUiStore.getState().activeRoomId) {
            notify({
              title: n.actor_name ?? n.title ?? 'Уведомление',
              text: n.preview ?? NOTIF_FALLBACK[n.kind],
              avatarName: n.actor_name ?? undefined,
              avatarUrl: n.actor_id != null ? usersRef.current.get(n.actor_id)?.avatar_url ?? null : null,
              onClick: () => openRef.current(n),
            })
          }
          break
        }
        case 'notification.removed': {
          // Сервер снял уведомление (напр. админ зачёл день дневника) — убрать из
          // колокольчика и, если оно было непрочитанным, уменьшить счётчик бейджа.
          qc.setQueryData<NotificationListOut>(notificationsKey, (old) => {
            if (!old) return old
            const present = old.items.some((it) => it.id === e.notification_id)
            return {
              items: old.items.filter((it) => it.id !== e.notification_id),
              unread_count:
                present && e.was_unread
                  ? Math.max(0, old.unread_count - 1)
                  : old.unread_count,
            }
          })
          break
        }
        case 'task.created':
          qc.invalidateQueries({ queryKey: tasksKey })
          if (!isAdminRef.current) notify({ title: 'Задачи', text: 'Новая задача' })
          break
        case 'task.updated':
          qc.invalidateQueries({ queryKey: tasksKey })
          qc.invalidateQueries({ queryKey: taskKey(e.task_id) })
          break
        case 'submission.new':
          // Новая сдача (для админа/автора общей задачи) — обновить треки и списки.
          qc.invalidateQueries({ queryKey: taskSubmissionsKey(e.task_id) })
          qc.invalidateQueries({ queryKey: taskKey(e.task_id) })
          qc.invalidateQueries({ queryKey: tasksKey })
          break
        case 'submission.status': {
          // Ревью прошло: статус назначения изменился (принято/возвращено).
          qc.invalidateQueries({ queryKey: taskSubmissionsKey(e.task_id) })
          qc.invalidateQueries({ queryKey: taskKey(e.task_id) })
          qc.invalidateQueries({ queryKey: tasksKey })
          if (!isAdminRef.current) {
            if (e.status === 'accepted') notify({ title: 'Задачи', text: 'Задача принята' })
            else if (e.status === 'returned') notify({ title: 'Задачи', text: 'Задача возвращена на доработку' })
          }
          break
        }
        case 'task.comment.new':
          qc.invalidateQueries({ queryKey: submissionCommentsKey(e.submission_id) })
          qc.invalidateQueries({ queryKey: taskSubmissionsKey(e.task_id) })
          break
        default:
          // pin.added/removed, read, subscribed/unsubscribed, error, pong — фазы 3+
          break
      }
    })
  }, [qc, markTyping, setOnline])
}
