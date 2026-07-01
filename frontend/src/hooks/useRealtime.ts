import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { appendMessage, bumpReplyCount, removeMessage, replaceMessage } from '../api/cache'
import { pinsKey } from '../api/pins'
import { roomsKey, useRooms } from '../api/rooms'
import { threadKey } from '../api/threads'
import { useAuth } from '../features/auth/AuthContext'
import { http } from '../lib/apiClient'
import { wsClient } from '../lib/wsClient'
import type { RoomOut, WsEvent } from '../lib/types'
import { useUiStore } from '../stores/ui'

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
  const meRef = useRef(user?.id ?? -1)
  meRef.current = user?.id ?? -1
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
        default:
          // pin.added/removed, read, subscribed/unsubscribed, error, pong — фазы 3+
          break
      }
    })
  }, [qc, markTyping, setOnline])
}
