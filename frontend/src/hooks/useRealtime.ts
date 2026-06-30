import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { appendMessage, removeMessage, replaceMessage } from '../api/cache'
import { roomsKey, useRooms } from '../api/rooms'
import { useAuth } from '../features/auth/AuthContext'
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
  const meRef = useRef(user?.id ?? -1)
  meRef.current = user?.id ?? -1
  const subscribed = useRef<Set<number>>(new Set())

  // Подписка на все комнаты юзера (live-сообщения и unread по всем).
  useEffect(() => {
    if (!rooms) return
    for (const r of rooms) {
      if (!subscribed.current.has(r.id)) {
        subscribed.current.add(r.id)
        wsClient.subscribe(r.id)
      }
    }
  }, [rooms])

  useEffect(() => {
    return wsClient.on((e: WsEvent) => {
      const me = meRef.current
      switch (e.type) {
        case 'message.new': {
          const msg = e.message
          if (msg.thread_root_id === null) appendMessage(qc, msg.room_id, msg)
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
