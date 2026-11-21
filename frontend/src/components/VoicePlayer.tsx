import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useVoiceWaveform } from '../hooks/useVoiceWaveform'
import { useMediaSession } from '../stores/mediaSession'
import { IconPause, IconPlay } from './icons'
import styles from './voicePlayer.module.css'

const SPEEDS = [1, 1.5, 2] as const

interface Props {
  src: string
  /** Длина записи в секундах из media_assets — показываем до загрузки метаданных. */
  duration?: number | null
  className?: string
  waveform?: boolean
}

function fmt(sec: number, long: boolean): string {
  if (!Number.isFinite(sec) || sec < 0) return long ? '0:00:00' : '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (long) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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
let voicePlayerSeq = 0

export function VoicePlayer({ src, duration, className, waveform }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  // Длину знаем из media_assets сразу; уточняем по loadedmetadata (точнее).
  const [total, setTotal] = useState(duration ?? 0)
  const [rate, setRate] = useState(1)
  // Стабильный id для координации «один звук за раз» (docs/FILES.md «Плейлист»):
  // запуск этого голосового ставит на паузу плейлист/другое голосовое, и наоборот.
  const sessionId = useRef(`voice-${++voicePlayerSeq}`)

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
      useMediaSession.getState().release(sessionId.current)
    }
    const onPause = () => setPlaying(false)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('ended', onEnd)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('ended', onEnd)
      el.removeEventListener('pause', onPause)
      useMediaSession.getState().release(sessionId.current)
    }
  }, [])

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      useMediaSession.getState().claim(sessionId.current, () => el.pause())
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
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0
  const long = max >= 3600
  const bars = useVoiceWaveform(rootRef, waveform ? src : null, max)
  const gradientId = useId()
  const wavePath = useMemo(() => bars?.map((level, i) => {
    const x = i * 4 + 2
    const half = Math.round(1 + level * 19) / 2
    return `M${x} ${12 - half}v${2 * half}`
  }).join(' '), [bars])
  const time = `${fmt(current, long)} / ${fmt(max, long)}`
  const seekControl = (
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
  )

  return (
    <div ref={rootRef} className={`${styles.wrap} ${className ?? ''}`} data-waveform={waveform || undefined}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className={styles.playBtn}
        onClick={toggle}
        aria-label={playing ? 'Пауза' : 'Воспроизвести'}
      >
        {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
      </button>
      {waveform ? (
        <div className={styles.timeline}>
          <div className={styles.waveTrack} data-ready={wavePath ? '' : undefined}>
            {bars && wavePath && (
              <svg
                className={styles.wave}
                viewBox={`0 0 ${bars.length * 4} 24`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id={gradientId}>
                    <stop offset={`${pct}%`} stopColor="var(--voice-signal)" />
                    <stop offset={`${pct}%`} stopColor="var(--text-secondary)" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <path d={wavePath} fill="none" stroke={`url(#${gradientId})`} strokeWidth={2} strokeLinecap="round" />
              </svg>
            )}
            {seekControl}
          </div>
          <span className={styles.time}>{time}</span>
        </div>
      ) : (
        <>
          {seekControl}
          <span className={styles.time}>{time}</span>
        </>
      )}
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
