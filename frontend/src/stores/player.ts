import { create } from 'zustand'
import type { PlaylistOut } from '../lib/types'
import { useMediaSession } from './mediaSession'

/**
 * Глобальный проигрыватель плейлиста-вложения (docs/FILES.md «Плейлист»).
 *
 * Один `<audio>` на всё приложение — рендерится один раз в `GlobalPlayer`
 * (смонтирован в корне layout'а), поэтому переживает переход между разделами
 * (роут поменялся — DOM-узел `<audio>` тот же, стор тот же). Сам стор хранит
 * только ДАННЫЕ (какой плейлист, какой трек, играет/пауза, позиция) — реальным
 * `<audio>` управляет `GlobalPlayer` через ref, подписанный на этот стор.
 */

const SESSION_ID = 'playlist'

interface PlayerState {
  playlist: PlaylistOut | null
  trackIndex: number
  isPlaying: boolean
  currentTime: number
  duration: number
  expanded: boolean
  /** Заполняется `GlobalPlayer`-ом при монтировании — сюда шлём императивные команды. */
  audioEl: HTMLAudioElement | null

  setAudioEl: (el: HTMLAudioElement | null) => void
  playPlaylist: (playlist: PlaylistOut, trackIndex?: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (t: number) => void
  setExpanded: (v: boolean) => void
  close: () => void
  // Обработчики событий <audio>, вызываются GlobalPlayer'ом.
  _onTime: (t: number) => void
  _onDuration: (d: number) => void
  _onEnded: () => void
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  playlist: null,
  trackIndex: 0,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  expanded: false,
  audioEl: null,

  setAudioEl: (el) => set({ audioEl: el }),

  playPlaylist: (playlist, trackIndex = 0) => {
    const { playlist: current, audioEl } = get()
    const sameTrack = current?.id === playlist.id && get().trackIndex === trackIndex
    useMediaSession.getState().claim(SESSION_ID, () => get().toggle())
    if (sameTrack && audioEl) {
      void audioEl.play()
      set({ isPlaying: true })
      return
    }
    set({ playlist, trackIndex, isPlaying: true, currentTime: 0 })
    // Реальный src/play — эффектом в GlobalPlayer (нужен доступ к track url).
  },

  toggle: () => {
    const { audioEl, isPlaying } = get()
    if (!audioEl) return
    if (isPlaying) {
      audioEl.pause()
      set({ isPlaying: false })
    } else {
      useMediaSession.getState().claim(SESSION_ID, () => get().toggle())
      void audioEl.play()
      set({ isPlaying: true })
    }
  },

  next: () => {
    const { playlist, trackIndex } = get()
    if (!playlist) return
    if (trackIndex + 1 < playlist.tracks.length) {
      set({ trackIndex: trackIndex + 1, currentTime: 0, isPlaying: true })
    }
  },

  prev: () => {
    const { playlist, trackIndex } = get()
    if (!playlist) return
    if (trackIndex > 0) {
      set({ trackIndex: trackIndex - 1, currentTime: 0, isPlaying: true })
    }
  },

  seek: (t) => {
    const { audioEl } = get()
    if (audioEl) audioEl.currentTime = t
    set({ currentTime: t })
  },

  setExpanded: (v) => set({ expanded: v }),

  close: () => {
    const { audioEl } = get()
    if (audioEl) audioEl.pause()
    useMediaSession.getState().release(SESSION_ID)
    set({
      playlist: null,
      trackIndex: 0,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      expanded: false,
    })
  },

  _onTime: (t) => set({ currentTime: t }),
  _onDuration: (d) => set({ duration: d }),
  _onEnded: () => {
    // Автопереход к следующему; на последнем треке — остановиться и свернуться на
    // первом (docs/FILES.md «Плейлист», «Готово, когда»).
    const { playlist, trackIndex } = get()
    if (!playlist) return
    if (trackIndex + 1 < playlist.tracks.length) {
      set({ trackIndex: trackIndex + 1, currentTime: 0, isPlaying: true })
    } else {
      useMediaSession.getState().release(SESSION_ID)
      set({ trackIndex: 0, currentTime: 0, isPlaying: false })
    }
  },
}))
