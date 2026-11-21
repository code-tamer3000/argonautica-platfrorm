import { ArrowLeft01Icon, Mic01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import styles from './VoicePill.module.css'

// Adapted from React Bits Voice Pill (https://reactbits.dev/c/micro/voice-pill).
const HOLD_AFTER = 300
const CANCEL_DISTANCE = 64
const SAMPLE_MS = 80
const MAX_BARS = 96

interface Press {
  id: number
  x: number
  at: number
  touch: boolean
  ownsRecording: boolean
  began: boolean
  holdTimer?: number
}

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
  const pressRef = useRef<Press | null>(null)
  const lastPointerUp = useRef(-Infinity)
  const [pressed, setPressed] = useState(false)

  useLayoutEffect(() => {
    const timer = timeRef.current
    const canvas = waveRef.current
    if (!timer || !canvas) return
    if (!active) {
      timer.textContent = '0:00'
      return
    }
    const ctx = canvas.getContext('2d')
    const levels: number[] = []
    let level = 0
    let width = 0
    let height = 0

    const paint = () => {
      if (!ctx || width < 4) return
      const count = Math.min(MAX_BARS, Math.floor(width / 4))
      const step = width / count
      ctx.clearRect(0, 0, width, height)
      for (let i = 0; i < count; i += 1) {
        const value = levels[levels.length - 1 - i]
        const barHeight = value === undefined ? 2 : Math.max(2, value * height)
        ctx.globalAlpha = value === undefined ? 0.25 : 0.6 + 0.4 * value
        ctx.fillRect(width - (i + 0.5) * step - 1, (height - barHeight) / 2, 2, barHeight)
      }
    }

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      if (ctx) {
        ctx.scale(ratio, ratio)
        ctx.fillStyle = getComputedStyle(canvas).color
      }
      paint()
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(canvas)
    resize()

    const draw = () => {
      if (document.hidden || startedAt === null) return
      const time = formatTime(performance.now() - startedAt)
      if (timer.textContent !== time) timer.textContent = time
      if (!ctx || width < 4) return

      level = Math.max(readLevel(), level * 0.72)
      levels.push(level)
      if (levels.length > MAX_BARS) levels.shift()
      paint()
    }

    draw()
    const interval = startedAt === null ? undefined : window.setInterval(draw, SAMPLE_MS)
    return () => {
      window.clearInterval(interval)
      observer?.disconnect()
    }
  }, [active, startedAt, readLevel])

  useEffect(() => () => window.clearTimeout(pressRef.current?.holdTimer), [])

  function clearPress() {
    window.clearTimeout(pressRef.current?.holdTimer)
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
    if (disabled) {
      clearPress()
      return
    }
    const press = pressRef.current
    if (!press?.ownsRecording || startedAt === null) return

    function cancel() {
      clearPress()
      onCancel()
    }

    function onVisibilityChange() {
      if (document.hidden) cancel()
    }

    if (!press.touch) window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [active, disabled, onCancel, pressed, startedAt])

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || pressRef.current || !event.isPrimary || event.button !== 0) return
    const touch = event.pointerType === 'touch'
    const press: Press = {
      id: event.pointerId, x: event.clientX, at: event.timeStamp, touch,
      ownsRecording: !active, began: !active && !touch,
    }
    pressRef.current = press
    if (!touch) event.currentTarget.setPointerCapture(event.pointerId)
    setPressed(true)
    if (active) return
    if (!touch) {
      onStart()
      return
    }

    // A touch tap starts on release. Only a sustained hold can open the mic
    // while a finger is down, since the permission prompt can interrupt a press.
    press.holdTimer = window.setTimeout(() => {
      if (pressRef.current !== press) return
      press.began = true
      onStart()
    }, HOLD_AFTER)
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current
    if (press?.id !== event.pointerId) return
    const root = event.currentTarget
    const pull = Math.max(0, press.x - event.clientX)
    if (pull < 4 && root.dataset.sliding === undefined) return
    if (pull >= CANCEL_DISTANCE) {
      clearPress()
      if (active) onCancel()
      return
    }
    if (!active) return
    root.dataset.sliding = ''
    root.style.setProperty('--vp-slide', `-${pull}px`)
    root.style.setProperty('--vp-cancel', String(pull / CANCEL_DISTANCE))
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (event.isPrimary) lastPointerUp.current = event.timeStamp
    const press = pressRef.current
    if (press?.id !== event.pointerId) return
    clearPress()
    if (press.ownsRecording && !press.began) {
      onStart()
      return
    }

    onRelease()
    // A system permission prompt can outlast the gesture. In that case
    // leave the new recording latched so the prompt does not discard it.
    const held = event.timeStamp - press.at >= HOLD_AFTER
    if (active && (!press.ownsRecording || (held && startedAt !== null))) onStop()
  }

  function onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current
    if (press?.id !== event.pointerId) return
    clearPress()
    if (!press.ownsRecording) return
    if (!press.touch) onCancel()
    else if (startedAt !== null) onStop()
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
      data-pressed={pressed ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onClick={(event) => {
        // Pointer clicks are handled on pointerdown/up. Keep keyboard and AT activation.
        if (event.detail !== 0 || pressRef.current) return
        if ('pointerType' in event.nativeEvent && event.nativeEvent.pointerType) return
        if (event.timeStamp - lastPointerUp.current < 500) return
        if (active) onStop()
        else onStart()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          lastPointerUp.current = -Infinity
          if (event.repeat) event.preventDefault()
        }
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
