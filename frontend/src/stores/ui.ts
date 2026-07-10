// Эфемерное UI-состояние: активная комната, «печатает», presence.
import { create } from 'zustand'
import type { MessageOut } from '../lib/types'

// Раздел дневника, «заряженный» в композер личного канала: следующая отправка
// (текст/вложение/голос/стикер) публикуется как запись этого раздела. `category` —
// ключ раздела активного задания; roomId — чтобы не переносить выбор между комнатами
// (композер сверяет со своим roomId).
export interface PendingJournal {
  roomId: number
  category: string
}

// Репост, «зажатый» админом: держим исходную комнату и само сообщение, пока админ
// в новостном канале дописывает к нему комментарий в композере.
export interface PendingRepost {
  roomId: number
  message: MessageOut
}

interface UiState {
  activeRoomId: number | null
  setActiveRoom: (id: number | null) => void

  // Запрос «открыть комнату» извне списка (клик по уведомлению/колокольчику).
  // ChatLayout подхватывает и сбрасывает. threadRootId зарезервирован под тред.
  pendingOpen: { roomId: number; threadRootId?: number } | null
  setPendingOpen: (v: { roomId: number; threadRootId?: number } | null) => void

  // Репост, ожидающий отправки в новостной канал (см. PendingRepost).
  pendingRepost: PendingRepost | null
  setPendingRepost: (r: PendingRepost | null) => void

  // Черновик, «заряженный» в композер комнаты (напр. шапка ответа админа на
  // обращение из техподдержки). Композер той же комнаты подставляет text один раз
  // и сбрасывает — дальше админ дописывает и отправляет сам.
  pendingDraft: { roomId: number; text: string } | null
  setPendingDraft: (v: { roomId: number; text: string } | null) => void

  // Категория дневника, «заряженная» в композер (см. PendingJournal).
  pendingJournal: PendingJournal | null
  setPendingJournal: (j: PendingJournal | null) => void

  // «Свободная запись» в личном дневнике: roomId канала, где пользователь выбрал
  // писать без формата. В личном дневнике композер скрыт, пока не выбран режим —
  // либо раздел задания (pendingJournal), либо свободная запись (этот флаг).
  journalFreeEntry: number | null
  setJournalFreeEntry: (roomId: number | null) => void

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

  pendingOpen: null,
  setPendingOpen: (v) => set({ pendingOpen: v }),

  pendingRepost: null,
  setPendingRepost: (r) => set({ pendingRepost: r }),

  pendingDraft: null,
  setPendingDraft: (v) => set({ pendingDraft: v }),

  pendingJournal: null,
  setPendingJournal: (j) => set({ pendingJournal: j }),

  journalFreeEntry: null,
  setJournalFreeEntry: (roomId) => set({ journalFreeEntry: roomId }),

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
