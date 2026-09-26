import { create } from 'zustand'
import {
  clearOfflinePlaylists,
  downloadPlaylist,
  isPlaylistDownloaded,
  listDownloadedPlaylists,
  removeDownloadedPlaylist,
} from '../lib/offlinePlaylists'
import type { PlaylistOut } from '../lib/types'

/**
 * Статус офлайн-скачивания плейлистов (ARG-145), по playlist_id — сама карточка
 * (`PlaylistCard`) читает отсюда, а не из IndexedDB напрямую, чтобы кнопка
 * «Скачать» сразу отражала прогресс без опроса стора вручную. `downloaded` —
 * реестр для списка в профиле (ARG-153), обновляется после каждого
 * скачивания/удаления, читается там же через `loadDownloaded`.
 */
type Status = 'idle' | 'downloading' | 'done' | 'error'

interface OfflinePlaylistsState {
  status: Record<number, Status>
  progress: Record<number, { done: number; total: number }>
  downloaded: PlaylistOut[]
  checkStatus: (playlist: PlaylistOut) => Promise<void>
  download: (playlist: PlaylistOut) => Promise<void>
  loadDownloaded: () => Promise<void>
  remove: (playlistId: number) => Promise<void>
  clearAll: () => Promise<void>
}

export const useOfflinePlaylists = create<OfflinePlaylistsState>((set, get) => ({
  status: {},
  progress: {},
  downloaded: [],

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
      await get().loadDownloaded()
    } catch {
      set((s) => ({ status: { ...s.status, [playlist.id]: 'error' } }))
    }
  },

  loadDownloaded: async () => {
    set({ downloaded: await listDownloadedPlaylists() })
  },

  remove: async (playlistId) => {
    await removeDownloadedPlaylist(playlistId)
    set((s) => ({
      status: { ...s.status, [playlistId]: 'idle' },
      downloaded: s.downloaded.filter((p) => p.id !== playlistId),
    }))
  },

  clearAll: async () => {
    await clearOfflinePlaylists()
    set({ status: {}, progress: {}, downloaded: [] })
  },
}))
