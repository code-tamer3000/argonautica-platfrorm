// Эфемерное UI-состояние: активная комната, «печатает», presence.
import { create } from 'zustand'
import type { MessageOut } from '../lib/types'

// Репост, «зажатый» админом: держим исходную комнату и само сообщение, пока админ
// в новостном канале дописывает к нему комментарий в композере.
export interface PendingRepost {
  roomId: number
  message: MessageOut
}

interface UiState {
  activeRoomId: number | null
  setActiveRoom: (id: number | null) => void

  // Репост, ожидающий отправки в новостной канал (см. PendingRepost).
  pendingRepost: PendingRepost | null
  setPendingRepost: (r: PendingRepost | null) => void

  // roomId -> userIds, печатающие прямо сейчас (с авто-истечением)
  typing: Record<number, number[]>
  // userId онлайн
  online: number[]

  // Пир личного чата (API не отдаёт состав dm — выводим из сообщений/создания).
  dmPeers: Record<number, number>
  setDmPeer: (roomId: number, userId: number) => void

  markTyping: (roomId: number, userId: number) => void
  setOnline: (userId: number, on: boolean) => void
}

const timers: Record<string, ReturnType<typeof setTimeout>> = {}

export const useUiStore = create<UiState>((set) => ({
  activeRoomId: null,
  setActiveRoom: (id) => set({ activeRoomId: id }),

  pendingRepost: null,
  setPendingRepost: (r) => set({ pendingRepost: r }),

  typing: {},
  online: [],

  dmPeers: {},
  setDmPeer: (roomId, userId) =>
    set((s) => (s.dmPeers[roomId] === userId ? s : { dmPeers: { ...s.dmPeers, [roomId]: userId } })),

  markTyping: (roomId, userId) => {
    const key = `${roomId}:${userId}`
    if (timers[key]) clearTimeout(timers[key])
    set((s) => {
      const cur = s.typing[roomId] ?? []
      return cur.includes(userId)
        ? s
        : { typing: { ...s.typing, [roomId]: [...cur, userId] } }
    })
    timers[key] = setTimeout(() => {
      set((s) => ({
        typing: { ...s.typing, [roomId]: (s.typing[roomId] ?? []).filter((u) => u !== userId) },
      }))
    }, 4000)
  },

  setOnline: (userId, on) =>
    set((s) => ({
      online: on
        ? s.online.includes(userId)
          ? s.online
          : [...s.online, userId]
        : s.online.filter((u) => u !== userId),
    })),
}))
