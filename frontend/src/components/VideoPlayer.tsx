import { useEffect, useRef, useState } from 'react'
import { resetKbVideoProgress, saveKbVideoProgress, useKbVideoProgress } from '../api/kb'
import { ProgressRing } from './ProgressRing'
import styles from './videoPlayer.module.css'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
// Не спамим PUT на каждый timeupdate (несколько раз в секунду) — сохраняем не чаще раза в 5с.
const PROGRESS_SAVE_INTERVAL_MS = 5000

interface Props {
  src: string
  // Размеры из media_assets — резервируют коробку с верным aspect-ratio до загрузки.
  width?: number | null
  height?: number | null
  // Постер-кадр (снят на клиенте при загрузке): показывается вместо чёрного прямоугольника,
  // пока видео не начали проигрывать. null — постера нет (старые видео), покажем скелетон.
  poster?: string | null
  className?: string
  // Задано только для видео из материалов КБ (ARG-118) — включает восстановление и
  // сохранение позиции просмотра на пользователя. Видео в чате/задачах эту позицию
  // не запоминают (вне границ задачи), поэтому проп передаётся адресно из KB-контекста.
  kbProgress?: { itemId: number; assetId: number }
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
export function VideoPlayer({ src, width, height, poster, className, kbProgress }: Props) {
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

  // --- Позиция просмотра (только для видео КБ, см. проп kbProgress) ---
  const progressQuery = useKbVideoProgress(kbProgress?.itemId ?? 0, kbProgress?.assetId ?? 0)
  const restoredRef = useRef(false)
  const lastSavedAtRef = useRef(0)
  // Актуальные kbProgress/данные в ref — читаются из обработчиков событий <video>,
  // которые не должны пересоздаваться при каждом ре-рендере.
  const kbProgressRef = useRef(kbProgress)
  kbProgressRef.current = kbProgress

  function saveProgress(force: boolean) {
    const kp = kbProgressRef.current
    const v = videoRef.current
    if (!kp || !v) return
    const now = Date.now()
    if (!force && now - lastSavedAtRef.current < PROGRESS_SAVE_INTERVAL_MS) return
    lastSavedAtRef.current = now
    void saveKbVideoProgress(kp.itemId, kp.assetId, v.currentTime)
  }

  // Восстанавливаем позицию, как только известны и метадата видео (readyState),
  // и ответ сервера — что бы из двух ни пришло позже.
  useEffect(() => {
    if (!kbProgress || restoredRef.current || !loaded || progressQuery.isLoading) return
    const position = progressQuery.data?.position_seconds
    const v = videoRef.current
    if (position && v) v.currentTime = position
    restoredRef.current = true
  }, [kbProgress, loaded, progressQuery.isLoading, progressQuery.data])

  // Закрыли лайтбокс/ушли со страницы посреди просмотра — сохранить последнюю позицию.
  useEffect(() => {
    return () => {
      const kp = kbProgressRef.current
      const v = videoRef.current
      if (kp && v && !v.ended && v.currentTime > 1) {
        void saveKbVideoProgress(kp.itemId, kp.assetId, v.currentTime)
      }
    }
  }, [])

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
          // Снимаем заглушку уже по метадате: на мобиле `loadeddata` (первый кадр) с
          // `preload="metadata"` часто не приходит до старта воспроизведения, а метадата
          // приходит всегда — иначе спиннер висел бы вечно поверх готового к игре видео.
          setLoaded(true)
        }}
        onLoadedData={() => setLoaded(true)}
        onTimeUpdate={() => saveProgress(false)}
        onPause={() => saveProgress(true)}
        onEnded={() => {
          const kp = kbProgressRef.current
          if (kp) void resetKbVideoProgress(kp.itemId, kp.assetId)
        }}
      />
      {/* Есть постер — его и показывает нативный <video>, скелетон не нужен. Без
          постера (старые видео) держим скелетон+крутилку до метадаты, дальше показываем
          нативный плеер с кнопкой play. Заглушка не блокирует тап (pointer-events:none). */}
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
