import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useImageDownload } from '../hooks/useImageDownload'
import styles from './overlay.module.css'

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
}

export function Modal({
  title,
  onClose,
  children,
  closeOnBackdrop = true,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  // По умолчанию клик по фону закрывает окно. Для форм с вводом (создание/выдача
  // задачи) выключаем это, чтобы случайный клик мимо не стирал набранный текст —
  // закрыть можно крестиком или Escape.
  closeOnBackdrop?: boolean
}) {
  useEscape(onClose)
  return (
    <div className={styles.backdrop} onClick={closeOnBackdrop ? onClose : undefined}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}>{title}</span>
          <button className={styles.x} onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}>{title}</span>
          <button className={styles.x} onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className={styles.bodyScroll}>{children}</div>
      </div>
    </div>
  )
}

/** Один элемент просмотра: адрес уже разрешён вызывающим (превью/оригинал/вариант). */
export interface LightboxItem {
  url: string
  kind: 'image' | 'video'
}

/**
 * Просмотр медиа поверх ленты. Два входа:
 *  - `url` + `kind` — одиночное вложение (как было);
 *  - `items` + `index` — группа (альбом сообщения): листается стрелками, клавишами
 *    ←/→ и горизонтальным свайпом, в углу — счётчик «2 / 5».
 *
 * key на текущем элементе обязателен: у LightboxImage/LightboxVideo своё внутреннее
 * состояние загрузки/буфера, и при переключении соседа его надо начинать заново, а не
 * донашивать от предыдущего кадра.
 */
export function Lightbox({
  url,
  kind,
  items,
  index = 0,
  onClose,
}: {
  url?: string
  kind?: 'image' | 'video'
  items?: LightboxItem[]
  index?: number
  onClose: () => void
}) {
  const list: LightboxItem[] =
    items && items.length ? items : url ? [{ url, kind: kind ?? 'image' }] : []
  const [at, setAt] = useState(Math.min(Math.max(index, 0), Math.max(list.length - 1, 0)))
  const total = list.length
  const step = (delta: number) => setAt((cur) => (cur + delta + total) % total)
  const touchX = useRef<number | null>(null)
  // Свайп только что пролистал группу — следующий синтетический клик по фону глотаем.
  const swiped = useRef(false)

  useEscape(onClose)
  useEffect(() => {
    if (total < 2) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setAt((cur) => (cur - 1 + total) % total)
      if (e.key === 'ArrowRight') setAt((cur) => (cur + 1) % total)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [total])

  const current = list[at]
  if (!current) return null

  return (
    <div
      className={styles.lightbox}
      onClick={() => {
        if (swiped.current) {
          swiped.current = false
          return
        }
        onClose()
      }}
      onTouchStart={(e) => {
        // Жест по нативным контролам видео (перемотка — это тоже горизонтальное
        // движение) листанием не считаем, иначе перемотка выкидывала бы к соседу.
        const onVideo = (e.target as HTMLElement | null)?.closest('video') != null
        touchX.current = onVideo ? null : e.touches[0]?.clientX ?? null
      }}
      onTouchEnd={(e) => {
        // Свайп листает группу; короткий/вертикальный жест не трогаем — там работает
        // обычный тап по фону (закрыть).
        const from = touchX.current
        touchX.current = null
        if (from === null || total < 2) return
        const dx = (e.changedTouches[0]?.clientX ?? from) - from
        if (Math.abs(dx) <= 48) return
        // Свайп завершился листанием — гасим «клик», который браузер синтезирует
        // следом, иначе просмотр тут же закрылся бы по тапу на фон.
        swiped.current = true
        step(dx > 0 ? -1 : 1)
      }}
    >
      {current.kind === 'image' ? (
        <LightboxImage key={current.url} url={current.url} />
      ) : (
        <LightboxVideo key={current.url} url={current.url} />
      )}

      {total > 1 && (
        <>
          <button
            className={`${styles.lightboxNav} ${styles.lightboxPrev}`}
            onClick={(e) => {
              e.stopPropagation()
              step(-1)
            }}
            aria-label="Предыдущее"
          >
            ‹
          </button>
          <button
            className={`${styles.lightboxNav} ${styles.lightboxNext}`}
            onClick={(e) => {
              e.stopPropagation()
              step(1)
            }}
            aria-label="Следующее"
          >
            ›
          </button>
          <span className={styles.lightboxCount}>{at + 1} / {total}</span>
        </>
      )}
    </div>
  )
}

/**
 * Картинка в лайтбоксе с прогрессом скачивания оригинала: нативный <img> процента не
 * даёт, поэтому тянем через fetch+stream (useImageDownload) и рисуем полосу поверх, пока
 * грузится. Best-effort — при недоступности потока откатывается на прямой src.
 */
function LightboxImage({ url }: { url: string }) {
  const { src, progress, loading } = useImageDownload(url)
  const pct = progress != null ? Math.round(progress * 100) : null
  return (
    <div className={styles.lightboxImageWrap} onClick={(e) => e.stopPropagation()}>
      <img className={styles.lightboxMedia} src={src} alt="" />
      {loading && pct != null && (
        <div className={styles.lightboxProgress} aria-hidden="true">
          <div className={styles.lightboxBar}>
            <div className={styles.lightboxBarFill} style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <span className={styles.lightboxPct}>{pct}%</span>
        </div>
      )}
    </div>
  )
}

/**
 * Видео в лайтбоксе стримится нативно (range-запросы → перемотка и старт до полной
 * загрузки), поэтому «процент скачивания» некорректен. Вместо него показываем состояние
 * буферизации: спиннер, пока видео не готово играть, и долю буфера (buffered / duration),
 * если длительность уже известна. Индикатор гаснет, когда браузер может проигрывать.
 */
function LightboxVideo({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // buffering — ждём данные (нет пригодного к воспроизведению кадра / произошёл waiting);
  // buffered — доля 0..1 по video.buffered/duration, либо null пока длительность неизвестна.
  const [buffering, setBuffering] = useState(true)
  const [buffered, setBuffered] = useState<number | null>(null)

  const sync = () => {
    const v = videoRef.current
    if (!v) return
    // Буфер вокруг текущей позиции: берём диапазон, покрывающий currentTime (или первый).
    const ranges = v.buffered
    if (v.duration > 0 && ranges.length > 0) {
      let end = 0
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= v.currentTime + 0.01) end = Math.max(end, ranges.end(i))
      }
      if (end === 0) end = ranges.end(ranges.length - 1)
      setBuffered(Math.min(1, end / v.duration))
    }
    // Готово играть без ожидания (>= HAVE_FUTURE_DATA) — прячем индикатор.
    if (v.readyState >= 3) setBuffering(false)
  }

  const pct = buffered != null ? Math.round(buffered * 100) : null

  return (
    <div className={styles.lightboxVideoWrap} onClick={(e) => e.stopPropagation()}>
      <video
        ref={videoRef}
        className={styles.lightboxMedia}
        src={url}
        controls
        autoPlay
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => setBuffering(false)}
        onProgress={sync}
        onTimeUpdate={sync}
        onLoadedMetadata={sync}
        onSeeking={() => setBuffering(true)}
      />
      {buffering && pct != null && (
        <div className={styles.lightboxProgress} aria-hidden="true">
          <div className={styles.lightboxBar}>
            <div className={styles.lightboxBarFill} style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <span className={styles.lightboxBufLabel}>буфер {pct}%</span>
        </div>
      )}
      {/* Длительность ещё неизвестна — процента нет, показываем спиннер. */}
      {buffering && pct == null && <div className={styles.lightboxSpinner} aria-hidden="true" />}
    </div>
  )
}
