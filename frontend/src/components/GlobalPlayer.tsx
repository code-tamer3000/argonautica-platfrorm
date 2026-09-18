import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../stores/player'
import styles from './globalPlayer.module.css'
import {
  IconChevronDown,
  IconClose,
  IconMusic,
  IconPause,
  IconPlay,
  IconSkipBack,
  IconSkipForward,
} from './icons'

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Глобальный мини-плеер плейлиста-вложения (docs/FILES.md «Плейлист»).
 *
 * Смонтирован ОДИН раз в корне layout'а (AppShell) — `<audio>` внутри переживает
 * переход между разделами/роутами, потому что сам компонент не размонтируется.
 * Липнет внизу экрана (над таб-баром на мобиле); разворачивается в список треков.
 * Ничего не рисует, пока не играет ни один плейлист.
 */
export function GlobalPlayer() {
  const playlist = usePlayerStore((s) => s.playlist)
  const trackIndex = usePlayerStore((s) => s.trackIndex)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const expanded = usePlayerStore((s) => s.expanded)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    usePlayerStore.getState().setAudioEl(audioRef.current)
    return () => usePlayerStore.getState().setAudioEl(null)
  }, [])

  // Сигнал для CSS (тот же приём, что html[data-kb='open'] в lib/viewport.ts):
  // .content/.composer резервируют место под фикс-бар, только когда он реально
  // на экране — иначе он физически перекрывает композер чата (жалоба на ARG-139).
  useEffect(() => {
    const root = document.documentElement
    if (playlist) root.setAttribute('data-player', 'open')
    else root.removeAttribute('data-player')
    return () => root.removeAttribute('data-player')
  }, [playlist])

  const track = playlist?.tracks[trackIndex]

  // Смена трека (в т.ч. первый запуск плейлиста) — подставить src и, если нужно,
  // запустить воспроизведение. Стор уже выставил isPlaying=true к этому моменту.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !track) return
    if (el.src !== track.url) {
      el.src = track.url
      el.currentTime = 0
    }
    if (isPlaying) void el.play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.asset_id])

  // Media Session API: заголовок/обложка/prev-next на лок-скрине и в системном
  // уведомлении телефона. Без этого Android/iOS показывают только play/pause и
  // перемотку по ±10с под общим именем PWA — не видно, какой трек играет, и
  // «следующий»/«предыдущий» недоступны (жалоба на ARG-139). Действия шлём через
  // getState() — обработчики регистрируются раз, актуальный стор читают сами.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !playlist || !track) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist ?? undefined,
      album: playlist.title,
      artwork: playlist.cover_url
        ? [{ src: playlist.cover_url, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    })
    navigator.mediaSession.setActionHandler('play', () => usePlayerStore.getState().toggle())
    navigator.mediaSession.setActionHandler('pause', () => usePlayerStore.getState().toggle())
    navigator.mediaSession.setActionHandler('previoustrack', () => usePlayerStore.getState().prev())
    navigator.mediaSession.setActionHandler('nexttrack', () => usePlayerStore.getState().next())
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) usePlayerStore.getState().seek(details.seekTime)
    })
    // ±10с системной перемотки — тоже настоящая позиция, а не no-op/фолбэк.
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const s = usePlayerStore.getState()
      s.seek(Math.max(0, s.currentTime - (details.seekOffset ?? 10)))
    })
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const s = usePlayerStore.getState()
      s.seek(s.currentTime + (details.seekOffset ?? 10))
    })
    return () => {
      navigator.mediaSession.metadata = null
      for (const action of [
        'play',
        'pause',
        'previoustrack',
        'nexttrack',
        'seekto',
        'seekbackward',
        'seekforward',
      ] as const) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {
          // Некоторые действия (например seekto) не во всех браузерах — не роняем эффект.
        }
      }
    }
  }, [playlist, track])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }, [isPlaying])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (isPlaying && el.paused) void el.play()
    if (!isPlaying && !el.paused) el.pause()
  }, [isPlaying])

  if (!playlist || !track) return null

  const store = usePlayerStore.getState
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <>
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => store()._onTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) {
            store()._onDuration(e.currentTarget.duration)
          }
        }}
        onEnded={() => store()._onEnded()}
      />
      <div className={styles.bar}>
        {/* Перемотка прямо в мини-баре, не только в развёрнутом виде — тонкий range
            поверх декоративной полосы (тот же приём, что VoicePlayer.seek). */}
        <input
          type="range"
          className={styles.seekMini}
          min={0}
          max={duration || 1}
          step={0.5}
          value={currentTime}
          // Визуально двигаем ползунок на каждый тик drag'а, но реально перематываем
          // ТОЛЬКО по отпусканию — иначе на медленной сети ползунок «доезжает и
          // откатывается» пока <audio> догоняет частые currentTime= (см. stores/player.ts).
          onChange={(e) => usePlayerStore.getState().previewSeek(Number(e.target.value))}
          onPointerUp={(e) => usePlayerStore.getState().seek(Number(e.currentTarget.value))}
          onKeyUp={(e) => usePlayerStore.getState().seek(Number(e.currentTarget.value))}
          onClick={(e) => e.stopPropagation()}
          style={{ ['--pct' as string]: `${pct}%` }}
          aria-label="Позиция воспроизведения"
        />
        <button
          type="button"
          className={styles.cover}
          onClick={() => usePlayerStore.getState().setExpanded(!expanded)}
          aria-label={expanded ? 'Свернуть плеер' : 'Развернуть плеер'}
        >
          {playlist.cover_url ? (
            <img src={playlist.cover_url} alt="" />
          ) : (
            <IconMusic size={18} />
          )}
        </button>
        <div className={styles.meta} onClick={() => usePlayerStore.getState().setExpanded(true)}>
          <span className={styles.trackTitle}>{track.title}</span>
          <span className={styles.trackArtist}>
            {track.artist ? `${track.artist} · ` : ''}
            {playlist.title}
          </span>
        </div>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.ctrlBtn}
            disabled={trackIndex === 0}
            onClick={() => usePlayerStore.getState().prev()}
            aria-label="Предыдущий трек"
          >
            <IconSkipBack size={18} />
          </button>
          <button
            type="button"
            className={styles.playBtn}
            onClick={() => usePlayerStore.getState().toggle()}
            aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {isPlaying ? <IconPause size={18} /> : <IconPlay size={18} />}
          </button>
          <button
            type="button"
            className={styles.ctrlBtn}
            disabled={trackIndex + 1 >= playlist.tracks.length}
            onClick={() => usePlayerStore.getState().next()}
            aria-label="Следующий трек"
          >
            <IconSkipForward size={18} />
          </button>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => usePlayerStore.getState().close()}
          aria-label="Закрыть плеер"
        >
          <IconClose size={16} />
        </button>
      </div>

      {expanded && (
        <div className={styles.expandedOverlay} onClick={() => usePlayerStore.getState().setExpanded(false)}>
          <div className={styles.expandedSheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.expandedHeader}>
              <button
                type="button"
                className={styles.expandedCollapse}
                onClick={() => usePlayerStore.getState().setExpanded(false)}
                aria-label="Свернуть"
              >
                <IconChevronDown size={20} />
              </button>
              <span className={styles.expandedTitle}>{playlist.title}</span>
            </div>
            <div className={styles.expandedCoverWrap}>
              {playlist.cover_url ? (
                <img className={styles.expandedCover} src={playlist.cover_url} alt="" />
              ) : (
                <div className={styles.expandedCoverPlaceholder}>
                  <IconMusic size={40} />
                </div>
              )}
            </div>
            <div className={styles.expandedNow}>
              <span className={styles.expandedNowTitle}>{track.title}</span>
              {track.artist && <span className={styles.expandedNowArtist}>{track.artist}</span>}
            </div>
            <input
              type="range"
              className={styles.seek}
              min={0}
              max={duration || 1}
              step={0.5}
              value={currentTime}
              // См. комментарий у seekMini выше — то же preview/commit разделение.
              onChange={(e) => usePlayerStore.getState().previewSeek(Number(e.target.value))}
              onPointerUp={(e) => usePlayerStore.getState().seek(Number(e.currentTarget.value))}
              onKeyUp={(e) => usePlayerStore.getState().seek(Number(e.currentTarget.value))}
              aria-label="Позиция воспроизведения"
            />
            <div className={styles.timeRow}>
              <span>{fmt(currentTime)}</span>
              <span>{fmt(duration || track.duration || 0)}</span>
            </div>
            <div className={styles.expandedControls}>
              <button
                type="button"
                className={styles.ctrlBtn}
                disabled={trackIndex === 0}
                onClick={() => usePlayerStore.getState().prev()}
                aria-label="Предыдущий трек"
              >
                <IconSkipBack size={26} />
              </button>
              <button
                type="button"
                className={styles.expandedPlayBtn}
                onClick={() => usePlayerStore.getState().toggle()}
                aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
              >
                {isPlaying ? <IconPause size={26} /> : <IconPlay size={26} />}
              </button>
              <button
                type="button"
                className={styles.ctrlBtn}
                disabled={trackIndex + 1 >= playlist.tracks.length}
                onClick={() => usePlayerStore.getState().next()}
                aria-label="Следующий трек"
              >
                <IconSkipForward size={26} />
              </button>
            </div>
            <ul className={styles.queue}>
              {playlist.tracks.map((t, i) => (
                <li key={t.asset_id}>
                  <button
                    type="button"
                    className={`${styles.queueItem} ${i === trackIndex ? styles.queueItemActive : ''}`}
                    onClick={() => usePlayerStore.getState().playPlaylist(playlist, i)}
                  >
                    <span className={styles.queuePos}>{i + 1}</span>
                    <span className={styles.queueMeta}>
                      <span className={styles.queueTitle}>{t.title}</span>
                      {t.artist && <span className={styles.queueArtist}>{t.artist}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
