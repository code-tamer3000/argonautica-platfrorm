import { create } from 'zustand'

/**
 * Координация «только один звук за раз» — голосовые (VoicePlayer), видео в
 * лайтбоксе (VideoPlayer) и глобальный плеер плейлиста (playerStore) держат
 * каждый свой `<audio>`/`<video>`, поэтому без общего реестра ничего не мешает
 * им звучать одновременно. Любой плеер перед началом воспроизведения зовёт
 * `claim(id, stop)`; предыдущий держатель получает `stop()` — ставит себя на паузу.
 */
type StopFn = () => void

interface MediaSessionState {
  activeId: string | null
  activeStop: StopFn | null
  claim: (id: string, stop: StopFn) => void
  release: (id: string) => void
}

export const useMediaSession = create<MediaSessionState>((set, get) => ({
  activeId: null,
  activeStop: null,
  claim: (id, stop) => {
    const { activeId, activeStop } = get()
    if (activeId && activeId !== id && activeStop) activeStop()
    set({ activeId: id, activeStop: stop })
  },
  release: (id) => {
    if (get().activeId === id) set({ activeId: null, activeStop: null })
  },
}))
