import { useCallback, useEffect, useRef, useState } from 'react'
import { getOfflineTrackUrl } from '../lib/offlinePlaylists'
import { usePlayerStore } from '../stores/player'
import { toast } from '../stores/toast'
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
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Плейлист, запущенный из списка «Скачанные плейлисты» в профиле (ARG-153),
  // приходит сюда снимком на момент скачивания — его cover_url presigned-ссылка
  // могла протухнуть к моменту воспроизведения (та же протухающая подпись, что и
  // у любого другого presigned-URL). Без onError-фолбэка сломанная иконка
  // браузера так и висела бы вместо плейсхолдера дизайн-системы.
  const [coverBroken, setCoverBroken] = useState(false)
  useEffect(() => setCoverBroken(false), [playlist?.id])

  // Callback-ref, а НЕ useEffect([]): <audio> рендерится только когда есть что
  // играть, поэтому на монтировании компонента его в DOM ещё нет и эффект с
  // пустыми deps записывал в стор null — навсегда. Из-за этого toggle() молча
  // выходил (кнопка паузы «не работает»), а seek() не трогал элемент и ползунок
  // откатывался следующим timeupdate (ARG-139, отзыв после выката).
  const setAudio = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el
    usePlayerStore.getState().setAudioEl(el)
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
  // Источник — сначала локально скачанный для офлайна блоб (ARG-145), иначе как
  // раньше presigned-URL; проверка асинхронная (поход в IndexedDB), поэтому
  // отменяем результат, если трек успел смениться ещё раз, пока ждали ответ.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !track) return
    let cancelled = false
    void getOfflineTrackUrl(track.asset_id).then((offlineUrl) => {
      if (cancelled) return
      const src = offlineUrl ?? track.url
      if (el.src !== src) {
        el.src = src
        el.currentTime = 0
      }
      if (usePlayerStore.getState().isPlaying) void el.play()
    })
    return () => {
      cancelled = true
    }
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
    // Каждый handler — своей try/catch: на iOS Safari 'seekto' исторически не
    // поддерживался и падение на нём обрывало бы регистрацию prev/next, которые
    // идут ПОСЛЕ него (в итоге ОС показывала бы только системную перемотку ±Nс
    // вместо кнопок «трек вперёд/назад» — жалоба на ARG-139). play/pause шлют
    // команду ПРЯМО в <audio> (не toggle/наш стор) — состояние обновится по
    // настоящим onPlay/onPause, кнопка ОС не должна гадать по нашему isPlaying.
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', () => void usePlayerStore.getState().audioEl?.play()],
      ['pause', () => usePlayerStore.getState().audioEl?.pause()],
      ['previoustrack', () => usePlayerStore.getState().prev()],
      ['nexttrack', () => usePlayerStore.getState().next()],
      [
        'seekto',
        (details) => {
          if (details.seekTime != null) usePlayerStore.getState().seek(details.seekTime)
        },
      ],
    ]
    // ±10с системной перемотки НЕ регистрируем, когда в плейлисте больше одного
    // трека: iOS отдаёт в системном плеере ограниченный набор кнопок и, если
    // seekbackward/seekforward заданы, показывает именно их ВМЕСТО «трек вперёд/
    // назад» (жалоба после выката ARG-139). Явный null перебивает и поведение
    // браузера по умолчанию. Для плейлиста из одного трека наоборот — ±10с
    // полезнее бесполезных перелистываний.
    const single = playlist.tracks.length < 2
    const seekBy = (delta: number) => {
      const s = usePlayerStore.getState()
      s.seek(Math.max(0, Math.min(s.duration || Infinity, s.currentTime + delta)))
    }
    handlers.push(
      ['seekbackward', single ? (d) => seekBy(-(d.seekOffset ?? 10)) : null],
      ['seekforward', single ? (d) => seekBy(d.seekOffset ?? 10) : null],
    )
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        // Действие не поддержано этим браузером — остальные регистрируем как есть.
      }
    }
    return () => {
      navigator.mediaSession.metadata = null
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {
          // См. выше.
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
        ref={setAudio}
        // isPlaying — ТОЛЬКО отсюда (настоящие play/pause элемента), не руками в
        // toggle/next/prev/playPlaylist: иначе кнопка визуально «не работает»,
        // когда стор и реальный <audio> расходятся (ARG-139, отзыв после ревью).
        onPlay={() => store()._onPlay()}
        onPause={() => store()._onPause()}
        onTimeUpdate={(e) => store()._onTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) {
            store()._onDuration(e.currentTarget.duration)
          }
        }}
        // Перемотка реально завершилась (буфер догнал целевую позицию) — только
        // теперь снова доверяем timeupdate. До этого момента isSeeking держит
        // показанную позицию неподвижной (см. stores/player.ts::seek).
        onSeeked={(e) => store()._onSeeked(e.currentTarget.currentTime)}
        onEnded={() => store()._onEnded()}
        // Трек не скачан для офлайна и сети нет — presigned-URL не загрузится.
        // Без этого браузер просто молча стопорится на текущем треке (см. «Готово,
        // когда» в ARG-145: офлайн-плейлист без сети должен явно сказать об этом).
        onError={() => {
          if (!navigator.onLine) {
            // Ожидаемое состояние (нет сети + не скачано), не сбой — 'info',
            // не тревожный 'error' (тот же честный тон, что и ARG-150).
            toast('Нужна сеть — этот плейлист не скачан для офлайна', 'info')
          }
        }}
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
          // Три дублирующих коммита разом: pointerup не везде надёжен внутри
          // WebView PWA-обёртки, mouseup/touchend — подстраховка (idempotent).
          onPointerUp={(e) => usePlayerStore.getState().seek(Number(e.currentTarget.value))}
          onMouseUp={(e) => usePlayerStore.getState().seek(Number(e.currentTarget.value))}
          onTouchEnd={(e) => usePlayerStore.getState().seek(Number(e.currentTarget.value))}
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
          {playlist.cover_url && !coverBroken ? (
            <img src={playlist.cover_url} alt="" onError={() => setCoverBroken(true)} />
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
              {playlist.cover_url && !coverBroken ? (
                <img
                  className={styles.expandedCover}
                  src={playlist.cover_url}
                  alt=""
                  onError={() => setCoverBroken(true)}
                />
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
              onMouseUp={(e) => usePlayerStore.getState().seek(Number(e.currentTarget.value))}
              onTouchEnd={(e) => usePlayerStore.getState().seek(Number(e.currentTarget.value))}
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
