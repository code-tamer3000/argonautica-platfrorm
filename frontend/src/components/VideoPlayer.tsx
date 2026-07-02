import { useRef, useState } from 'react'
import styles from './videoPlayer.module.css'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

interface Props {
  src: string
  className?: string
}

/**
 * Видео-плеер поверх нативного <video controls> с явным переключателем скорости.
 *
 * Нативная смена скорости на мобиле (особенно iOS Safari) спрятана/недоступна, а на
 * десктопе — в контекстном меню. Даём отдельную кнопку-«×N» в углу: список скоростей
 * применяется к playbackRate. Остальные контролы (плей/пауза/перемотка/громкость/
 * фуллскрин) — нативные.
 */
export function VideoPlayer({ src, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [rate, setRate] = useState(1)
  const [menuOpen, setMenuOpen] = useState(false)

  function applyRate(r: number) {
    if (videoRef.current) videoRef.current.playbackRate = r
    setRate(r)
    setMenuOpen(false)
  }

  return (
    <div className={`${styles.wrap} ${className ?? ''}`}>
      <video ref={videoRef} className={styles.video} src={src} controls playsInline preload="metadata" />
      <div className={styles.speedControl}>
        <button
          type="button"
          className={styles.speedBtn}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Скорость воспроизведения"
        >
          {rate}×
        </button>
        {menuOpen && (
          <div className={styles.speedMenu} role="menu">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.speedItem} ${s === rate ? styles.speedItemActive : ''}`}
                onClick={() => applyRate(s)}
                role="menuitemradio"
                aria-checked={s === rate}
              >
                {s}×
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
