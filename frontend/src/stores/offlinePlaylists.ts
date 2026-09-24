import { create } from 'zustand'
import { downloadPlaylist, isPlaylistDownloaded, clearOfflinePlaylists } from '../lib/offlinePlaylists'
import type { PlaylistOut } from '../lib/types'

/**
 * Статус офлайн-скачивания плейлистов (ARG-145), по playlist_id — сама карточка
 * (`PlaylistCard`) читает отсюда, а не из IndexedDB напрямую, чтобы кнопка
 * «Скачать» сразу отражала прогресс без опроса стора вручную.
 */
type Status = 'idle' | 'downloading' | 'done' | 'error'

interface OfflinePlaylistsState {
  status: Record<number, Status>
  progress: Record<number, { done: number; total: number }>
  checkStatus: (playlist: PlaylistOut) => Promise<void>
  download: (playlist: PlaylistOut) => Promise<void>
  clearAll: () => Promise<void>
}

export const useOfflinePlaylists = create<OfflinePlaylistsState>((set, get) => ({
  status: {},
  progress: {},

  checkStatus: async (playlist) => {
    // Не перебивать статус активного скачивания опозданием асинхронной проверки.
    if (get().status[playlist.id] === 'downloading') return
    const done = await isPlaylistDownloaded(playlist)
    set((s) => ({ status: { ...s.status, [playlist.id]: done ? 'done' : 'idle' } }))
  },

  download: async (playlist) => {
    if (get().status[playlist.id] === 'downloading') return
    set((s) => ({
      status: { ...s.status, [playlist.id]: 'downloading' },
      progress: { ...s.progress, [playlist.id]: { done: 0, total: playlist.tracks.length } },
    }))
    try {
      await downloadPlaylist(playlist, (done, total) =>
        set((s) => ({ progress: { ...s.progress, [playlist.id]: { done, total } } })),
      )
      set((s) => ({ status: { ...s.status, [playlist.id]: 'done' } }))
    } catch {
      set((s) => ({ status: { ...s.status, [playlist.id]: 'error' } }))
    }
  },

  clearAll: async () => {
    await clearOfflinePlaylists()
    set({ status: {}, progress: {} })
  },
}))
