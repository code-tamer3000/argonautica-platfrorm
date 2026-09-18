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
  /** Идёт перетаскивание ползунка перемотки — см. `previewSeek`/`seek`. */
  isSeeking: boolean
  /** Страховка от «завис навсегда»: если `seeked` почему-то не пришёл (ошибка
   * сети/элемента), снимаем isSeeking сами через таймаут — см. `seek`. */
  seekTimeout: ReturnType<typeof setTimeout> | null
  /** Позиция, на которую сейчас идёт перемотка, — чтобы отличить дубль коммита
   * одного жеста (pointerup+mouseup+touchend) от новой перемотки, см. `seek`. */
  seekTarget: number | null

  setAudioEl: (el: HTMLAudioElement | null) => void
  playPlaylist: (playlist: PlaylistOut, trackIndex?: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  /** Визуальная позиция ПОКА тащат ползунок — audio.currentTime не трогаем (см.
   * комментарий у `seek`), иначе на медленной сети трек «прыгает и откатывается». */
  previewSeek: (t: number) => void
  /** Финальная перемотка — вызывать по отпусканию ползунка (pointerup/mouseup/
   * touchend — дублируем на все три: WebView внутри PWA не всегда полноценно
   * поддерживает Pointer Events), не на каждый тик drag'а: presigned-аудио не
   * всегда буферизовано целиком, и частые `currentTime =` заставляют браузер
   * постоянно переоткрывать range-запрос. isSeeking снимается НЕ здесь сразу, а
   * по настоящему `seeked` (`_onSeeked`) — иначе между командой на seek и тем,
   * как <audio> реально долистает буфер, `_onTime` успевает вернуть старую
   * позицию и ползунок визуально «доезжает и откатывается назад». */
  seek: (t: number) => void
  setExpanded: (v: boolean) => void
  close: () => void
  // Обработчики событий <audio>, вызываются GlobalPlayer'ом. isPlaying ТОЛЬКО
  // отсюда (из настоящих play/pause событий элемента) — не выставляется руками
  // в toggle/playPlaylist/next/prev: раньше стор и реальный <audio> расходились
  // (напр. play() не удался/browser сам поставил на паузу), и кнопка визуально
  // «не работала» — жала toggle() по УЖЕ неверному состоянию, отправляя команду
  // в противоположную сторону (ARG-139, отзыв после ревью).
  _onPlay: () => void
  _onPause: () => void
  _onTime: (t: number) => void
  _onDuration: (d: number) => void
  _onSeeked: (t: number) => void
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
  isSeeking: false,
  seekTimeout: null,
  seekTarget: null,

  setAudioEl: (el) => set({ audioEl: el }),

  playPlaylist: (playlist, trackIndex = 0) => {
    const { playlist: current, audioEl } = get()
    const sameTrack = current?.id === playlist.id && get().trackIndex === trackIndex
    useMediaSession.getState().claim(SESSION_ID, () => audioEl?.pause())
    if (sameTrack && audioEl) {
      void audioEl.play()
      return
    }
    // isPlaying:true — намерение (сыграть НОВЫЙ трек сразу после подстановки src
    // эффектом в GlobalPlayer); подтвердит/поправит его настоящий onPlay/onPause.
    set({ playlist, trackIndex, isPlaying: true, currentTime: 0, isSeeking: false, seekTarget: null })
  },

  toggle: () => {
    const { audioEl } = get()
    if (!audioEl) return
    // Источник истины — audioEl.paused, а не наш стор: если play() когда-то не
    // удался или браузер поставил на паузу сам, стор мог разойтись с реальностью.
    if (audioEl.paused) {
      useMediaSession.getState().claim(SESSION_ID, () => audioEl.pause())
      void audioEl.play()
    } else {
      audioEl.pause()
    }
  },

  next: () => {
    const { playlist, trackIndex } = get()
    if (!playlist) return
    if (trackIndex + 1 < playlist.tracks.length) {
      set({ trackIndex: trackIndex + 1, currentTime: 0, isPlaying: true, isSeeking: false, seekTarget: null })
    }
  },

  prev: () => {
    const { playlist, trackIndex } = get()
    if (!playlist) return
    if (trackIndex > 0) {
      set({ trackIndex: trackIndex - 1, currentTime: 0, isPlaying: true, isSeeking: false, seekTarget: null })
    }
  },

  previewSeek: (t) => set({ currentTime: t, isSeeking: true }),

  seek: (t) => {
    const { audioEl, seekTimeout, isSeeking, seekTarget } = get()
    // pointerup/mouseup/touchend дублируют коммит ОДНОГО жеста (см. тип выше).
    // Дубль распознаём по цели перемотки, а НЕ по audioEl.currentTime: элемент
    // обновляет currentTime сразу, а событие `seeked` присылает позже, так что
    // второй вызов «видел» бы позицию уже на месте, снимал isSeeking досрочно —
    // и ближайший timeupdate со старой позицией возвращал ползунок назад.
    if (isSeeking && seekTarget !== null && Math.abs(seekTarget - t) <= 0.25) return
    if (seekTimeout) clearTimeout(seekTimeout)
    if (audioEl && Math.abs(audioEl.currentTime - t) > 0.25) {
      audioEl.currentTime = t
      // Страховка: если seeked не пришёл за 4с (сеть/ошибка элемента), снимаем
      // isSeeking сами — иначе ползунок замер бы навсегда.
      const timeout = setTimeout(() => {
        if (get().isSeeking) set({ isSeeking: false, seekTimeout: null, seekTarget: null })
      }, 4000)
      set({ currentTime: t, isSeeking: true, seekTimeout: timeout, seekTarget: t })
    } else {
      set({ currentTime: t, isSeeking: false, seekTimeout: null, seekTarget: null })
    }
  },

  setExpanded: (v) => set({ expanded: v }),

  close: () => {
    const { audioEl, seekTimeout } = get()
    if (audioEl) audioEl.pause()
    if (seekTimeout) clearTimeout(seekTimeout)
    useMediaSession.getState().release(SESSION_ID)
    set({
      playlist: null,
      trackIndex: 0,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      expanded: false,
      isSeeking: false,
      seekTimeout: null,
      seekTarget: null,
    })
  },

  _onPlay: () => {
    useMediaSession.getState().claim(SESSION_ID, () => get().audioEl?.pause())
    set({ isPlaying: true })
  },
  _onPause: () => {
    useMediaSession.getState().release(SESSION_ID)
    set({ isPlaying: false })
  },
  _onTime: (t) => {
    // Пока тащат ползунок ИЛИ ждём завершения перемотки (isSeeking), показанная
    // позиция — то, что задал пользователь, а не то, что успел доиграть <audio>
    // с предыдущей позиции (иначе визуально «откатывается» назад, см. `seek`).
    if (!get().isSeeking) set({ currentTime: t })
  },
  _onDuration: (d) => set({ duration: d }),
  _onSeeked: (t) => {
    const { seekTimeout } = get()
    if (seekTimeout) clearTimeout(seekTimeout)
    set({ currentTime: t, isSeeking: false, seekTimeout: null, seekTarget: null })
  },
  _onEnded: () => {
    // Автопереход к следующему; на последнем треке — остановиться и свернуться на
    // первом (docs/FILES.md «Плейлист», «Готово, когда»).
    const { playlist, trackIndex } = get()
    if (!playlist) return
    if (trackIndex + 1 < playlist.tracks.length) {
      set({ trackIndex: trackIndex + 1, currentTime: 0, isPlaying: true, isSeeking: false, seekTarget: null })
    } else {
      useMediaSession.getState().release(SESSION_ID)
      set({ trackIndex: 0, currentTime: 0, isPlaying: false, isSeeking: false, seekTarget: null })
    }
  },
}))
