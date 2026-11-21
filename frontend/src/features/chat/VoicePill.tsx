import { ArrowLeft01Icon, Mic01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import styles from './VoicePill.module.css'

// Adapted from React Bits Voice Pill (https://reactbits.dev/c/micro/voice-pill).
const HOLD_AFTER = 300
const CANCEL_DISTANCE = 64
const SAMPLE_MS = 64
const BAR_STEP = 3

interface Props {
  active: boolean
  startedAt: number | null
  disabled?: boolean
  readLevel: () => number
  onStart: () => void
  onStop: () => void
  onCancel: () => void
  onRelease: () => void
}

function formatTime(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function VoicePill({
  active, startedAt, disabled, readLevel, onStart, onStop, onCancel, onRelease,
}: Props) {
  const rootRef = useRef<HTMLButtonElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const pressRef = useRef<{ id: number; x: number; at: number; started: boolean } | null>(null)
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    const timer = timeRef.current
    const canvas = waveRef.current
    if (!timer || !canvas) return
    if (startedAt === null) {
      if (active) timer.textContent = '0:00'
      return
    }

    const ctx = canvas.getContext('2d')
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    if (ctx) {
      ctx.scale(ratio, ratio)
      ctx.fillStyle = getComputedStyle(timer).color
    }

    const levels: number[] = []
    const limit = Math.ceil(width / BAR_STEP)
    let envelope = 0
    let peak = 0
    let lastFrame = startedAt
    let lastSample = startedAt - SAMPLE_MS
    let frameId: number
    const draw = (now: number) => {
      const time = formatTime(now - startedAt)
      if (timer.textContent !== time) timer.textContent = time

      const level = readLevel()
      const elapsed = Math.max(0, Math.min(50, now - lastFrame))
      const response = level > envelope ? 40 : 240
      envelope += (level - envelope) * (1 - Math.exp(-elapsed / response))
      lastFrame = now
      peak = Math.max(peak, envelope)

      if (now - lastSample >= SAMPLE_MS) {
        levels.push(peak)
        if (levels.length > limit) levels.shift()
        lastSample = now
        peak = 0
      }

      if (ctx) {
        ctx.clearRect(0, 0, width, height)
        const shift = (now - lastSample) / SAMPLE_MS * BAR_STEP
        for (let i = 0; i < levels.length; i += 1) {
          const value = levels[levels.length - 1 - i]
          const x = width - (i + 1) * BAR_STEP - shift
          const barHeight = Math.max(2, (0.1 + 0.9 * value) * height)
          const fade = Math.min(1, Math.max(0, x / (width * 0.55)))
          ctx.globalAlpha = (0.35 + 0.65 * value) * fade * fade * (3 - 2 * fade)
          ctx.fillRect(x, (height - barHeight) / 2, 2, barHeight)
        }
      }

      frameId = requestAnimationFrame(draw)
    }

    frameId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frameId)
  }, [active, startedAt, readLevel])

  function clearPress() {
    pressRef.current = null
    setPressed(false)
    const root = rootRef.current
    if (root) {
      delete root.dataset.sliding
      root.style.removeProperty('--vp-slide')
      root.style.removeProperty('--vp-cancel')
    }
  }

  useEffect(() => {
    if (!pressed) return
    if (!active || disabled) {
      clearPress()
      return
    }
    if (startedAt === null) return

    function cancel() {
      clearPress()
      onCancel()
    }

    function onVisibilityChange() {
      if (document.hidden) cancel()
    }

    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [active, disabled, onCancel, pressed, startedAt])

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || pressRef.current || !event.isPrimary || event.button !== 0) return
    pressRef.current = { id: event.pointerId, x: event.clientX, at: performance.now(), started: !active }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPressed(true)
    if (!active) onStart()
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current
    if (press?.id !== event.pointerId || !active) return
    const root = event.currentTarget
    const pull = Math.max(0, press.x - event.clientX)
    if (pull < 4 && root.dataset.sliding === undefined) return
    if (pull >= CANCEL_DISTANCE) {
      clearPress()
      onCancel()
      return
    }
    root.dataset.sliding = ''
    root.style.setProperty('--vp-slide', `-${pull}px`)
    root.style.setProperty('--vp-cancel', String(pull / CANCEL_DISTANCE))
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current
    if (press?.id !== event.pointerId) return
    clearPress()
    onRelease()
    if (active && (!press.started || performance.now() - press.at >= HOLD_AFTER)) onStop()
  }

  function onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (pressRef.current?.id !== event.pointerId) return
    clearPress()
    if (active) onCancel()
  }

  return (
    <button
      ref={rootRef}
      type="button"
      className={styles.pill}
      disabled={disabled}
      aria-label="Запись голосового"
      aria-pressed={active}
      title={active ? 'Остановить запись' : 'Записать голосовое'}
      data-active={active ? '' : undefined}
      data-recording={startedAt !== null ? '' : undefined}
      data-pressed={pressed ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onClick={(event) => {
        // Pointer clicks are handled on pointerdown/up. Keep keyboard and AT activation.
        if (event.detail !== 0 || pressRef.current) return
        if (active) onStop()
        else onStart()
      }}
      onKeyDown={(event) => {
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
        if (active && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          clearPress()
          onCancel()
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className={styles.capsule} aria-hidden="true" />
      <canvas ref={waveRef} className={styles.wave} aria-hidden="true" />
      <span className={styles.cancel} aria-hidden="true">
        <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={2.2} />
        Отменить
      </span>
      <span ref={timeRef} className={styles.time} aria-hidden="true">0:00</span>
      <span className={styles.glyph} aria-hidden="true">
        <span className={styles.mic}><HugeiconsIcon icon={Mic01Icon} size={20} strokeWidth={2} /></span>
        <span className={styles.stop} />
      </span>
    </button>
  )
}
