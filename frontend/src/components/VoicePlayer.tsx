import { useEffect, useRef, useState } from 'react'
import { IconPause, IconPlay } from './icons'
import styles from './voicePlayer.module.css'

const SPEEDS = [1, 1.5, 2] as const

interface Props {
  src: string
  /** Длина записи в секундах из media_assets — показываем до загрузки метаданных. */
  duration?: number | null
  className?: string
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Плеер голосового сообщения поверх нативного <audio>.
 *
 * Свой компактный контрол (play/pause + прогресс-полоса + время + скорость) вместо
 * `<audio controls>`: нативный бар громоздкий, по-разному выглядит в браузерах и
 * плохо тянется в узкий пузырь сообщения. Скорость — как в VideoPlayer (1/1.5/2×),
 * привычно для длинных голосовых.
 */
export function VoicePlayer({ src, duration, className }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  // Длину знаем из media_assets сразу; уточняем по loadedmetadata (точнее).
  const [total, setTotal] = useState(duration ?? 0)
  const [rate, setRate] = useState(1)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => setCurrent(el.currentTime)
    const onMeta = () => {
      // Некоторые webm-записи отдают Infinity как duration — оставляем значение из БД.
      if (Number.isFinite(el.duration)) setTotal(el.duration)
    }
    const onEnd = () => {
      setPlaying(false)
      setCurrent(0)
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('ended', onEnd)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('ended', onEnd)
    }
  }, [])

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      void el.play()
      setPlaying(true)
    } else {
      el.pause()
      setPlaying(false)
    }
  }

  function cycleRate() {
    const next = SPEEDS[(SPEEDS.indexOf(rate as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]
    if (audioRef.current) audioRef.current.playbackRate = next
    setRate(next)
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const el = audioRef.current
    if (!el) return
    const t = Number(e.target.value)
    el.currentTime = t
    setCurrent(t)
  }

  const max = total || duration || 0
  const pct = max > 0 ? (current / max) * 100 : 0

  return (
    <div className={`${styles.wrap} ${className ?? ''}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className={styles.playBtn}
        onClick={toggle}
        aria-label={playing ? 'Пауза' : 'Воспроизвести'}
      >
        {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
      </button>
      <input
        type="range"
        className={styles.seek}
        min={0}
        max={max || 1}
        step={0.1}
        value={current}
        onChange={seek}
        style={{ ['--pct' as string]: `${pct}%` }}
        aria-label="Позиция воспроизведения"
      />
      <span className={styles.time}>{fmt(current || 0)} / {fmt(max)}</span>
      <button
        type="button"
        className={styles.rateBtn}
        onClick={cycleRate}
        aria-label="Скорость воспроизведения"
      >
        {rate}×
      </button>
    </div>
  )
}
