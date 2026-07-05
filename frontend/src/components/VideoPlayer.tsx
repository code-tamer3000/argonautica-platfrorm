import { useRef, useState } from 'react'
import { ProgressRing } from './ProgressRing'
import styles from './videoPlayer.module.css'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

interface Props {
  src: string
  // Размеры из media_assets — резервируют коробку с верным aspect-ratio до загрузки.
  width?: number | null
  height?: number | null
  // Постер-кадр (снят на клиенте при загрузке): показывается вместо чёрного прямоугольника,
  // пока видео не начали проигрывать. null — постера нет (старые видео), покажем скелетон.
  poster?: string | null
  className?: string
}

/**
 * Видео-плеер поверх нативного <video controls> с явным переключателем скорости.
 *
 * Нативная смена скорости на мобиле (особенно iOS Safari) спрятана/недоступна, а на
 * десктопе — в контекстном меню. Даём отдельную кнопку-«×N» в углу: список скоростей
 * применяется к playbackRate. Остальные контролы (плей/пауза/перемотка/громкость/
 * фуллскрин) — нативные.
 *
 * Коробка плеера резервируется по aspect-ratio из media_assets (проп width/height),
 * поэтому ещё до загрузки видео размер совпадает с итоговым — без чёрного прямоугольника
 * и без скачка рамок. Для старых записей без размеров ratio уточняется по loadedmetadata.
 * Пока кадр не готов, поверх показываем скелетон-плейсхолдер.
 */
export function VideoPlayer({ src, width, height, poster, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [rate, setRate] = useState(1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // aspect-ratio: из media_assets сразу; для старых записей — по loadedmetadata.
  const [ratio, setRatio] = useState(
    width && height ? width / height : undefined,
  )

  function applyRate(r: number) {
    if (videoRef.current) videoRef.current.playbackRate = r
    setRate(r)
    setMenuOpen(false)
  }

  return (
    <div
      className={`${styles.wrap} ${className ?? ''}`}
      style={ratio ? ({ ['--ar' as string]: ratio } as React.CSSProperties) : undefined}
    >
      <video
        ref={videoRef}
        className={styles.video}
        src={src}
        poster={poster ?? undefined}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          if (!ratio && v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight)
        }}
        onLoadedData={() => setLoaded(true)}
      />
      {/* Есть постер — его и показывает нативный <video>, скелетон не нужен. Без
          постера (старые видео) держим скелетон+крутилку до первого кадра. */}
      {!loaded && !poster && (
        <>
          <div className={styles.placeholder} aria-hidden="true" />
          {/* Видео стримится нативно (не тянем целиком ради перемотки), поэтому %
              недоступен — показываем крутилку, пока не готов первый кадр. */}
          <ProgressRing progress={null} />
        </>
      )}
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
