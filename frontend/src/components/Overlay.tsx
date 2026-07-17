import { useEffect, type ReactNode } from 'react'
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

export function Lightbox({ url, kind, onClose }: { url: string; kind: 'image' | 'video'; onClose: () => void }) {
  useEscape(onClose)
  return (
    <div className={styles.lightbox} onClick={onClose}>
      {kind === 'image' ? (
        <LightboxImage url={url} />
      ) : (
        // Видео стримится нативно (range-запросы), браузер сам рисует буферизацию —
        // «процент скачивания» для стрима некорректен, поэтому оставляем как есть.
        <video className={styles.lightboxMedia} src={url} controls autoPlay onClick={(e) => e.stopPropagation()} />
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
            <div className={styles.lightboxBarFill} style={{ width: `${pct}%` }} />
          </div>
          <span className={styles.lightboxPct}>{pct}%</span>
        </div>
      )}
    </div>
  )
}
