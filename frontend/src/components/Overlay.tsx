import { useEffect, type ReactNode } from 'react'
import styles from './overlay.module.css'

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose)
  return (
    <div className={styles.backdrop} onClick={onClose}>
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
        <img className={styles.lightboxMedia} src={url} alt="" onClick={(e) => e.stopPropagation()} />
      ) : (
        <video className={styles.lightboxMedia} src={url} controls autoPlay onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  )
}
