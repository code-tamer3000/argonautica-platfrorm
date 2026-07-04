import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { appendMessage, bumpReplyCount, removeMessage, replaceMessage } from '../api/cache'
import { notificationsKey } from '../api/notifications'
import { pinsKey } from '../api/pins'
import { roomsKey, useRooms } from '../api/rooms'
import { threadKey } from '../api/threads'
import { useUsersMap } from '../api/users'
import { useAuth } from '../features/auth/AuthContext'
import { useOpenNotification } from '../features/app/useOpenNotification'
import { http } from '../lib/apiClient'
import { wsClient } from '../lib/wsClient'
import type { NotificationKind, NotificationListOut, RoomOut, WsEvent } from '../lib/types'
import { notify } from '../stores/toast'
import { useUiStore } from '../stores/ui'

const NOTIF_FALLBACK: Record<NotificationKind, string> = {
  dm: 'Новое сообщение',
  reply: 'Ответил(а) на ваше сообщение',
  news: 'Новый пост в новостях',
  journal_missed: 'День дневника не закрыт',
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

  // При каждом реконнекте: сбрасываем локальный трекер и рефетчим комнаты.
  // wsClient сам переподпишет уже известные комнаты в ws.onopen;
  // рефетч нужен чтобы подписаться на комнаты созданные пока WS был оффлайн.
  useEffect(() => {
    return wsClient.onConnect(() => {
      subscribed.current.clear()
      void qc.invalidateQueries({ queryKey: roomsKey })
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
            appendMessage(qc, msg.room_id, msg)
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
              title: n.actor_name ?? 'Уведомление',
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
        default:
          // pin.added/removed, read, subscribed/unsubscribed, error, pong — фазы 3+
          break
      }
    })
  }, [qc, markTyping, setOnline])
}
