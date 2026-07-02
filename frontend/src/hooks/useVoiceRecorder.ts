import { useCallback, useEffect, useRef, useState } from 'react'

// Кодек по убыванию предпочтения. opus в webm/ogg — компактный и широко поддержан;
// mp4/aac — фолбэк для Safari, где webm/opus записи может не быть.
const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
}

export interface RecordedVoice {
  blob: Blob
  /** Длительность в секундах (по таймеру записи). */
  duration: number
}

export type RecorderState = 'idle' | 'recording' | 'recorded'

export interface VoiceRecorder {
  state: RecorderState
  /** Прошедшее время записи, сек (для таймера в UI). */
  elapsed: number
  /** Готовая запись (state === 'recorded'). */
  recorded: RecordedVoice | null
  supported: boolean
  error: string | null
  start: () => Promise<void>
  /** Остановить запись; blob появится в `recorded`. */
  stop: () => void
  /** Сбросить запись (удалить, вернуться в idle). */
  reset: () => void
}

/**
 * Запись голосового через MediaRecorder. Поток: start (запрос микрофона) →
 * recording (тикает elapsed) → stop → recorded (blob + duration).
 *
 * Длительность считаем по таймеру записи, а не по blob: webm без явного размера
 * часто отдаёт duration=Infinity в <audio>, а нам нужно точное число для
 * media_assets.duration ещё до заливки.
 */
export function useVoiceRecorder(): VoiceRecorder {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [recorded, setRecorded] = useState<RecordedVoice | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const supported =
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    if (!supported) {
      setError('Запись голоса не поддерживается этим браузером')
      return
    }
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickMime()
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const duration = (Date.now() - startedAtRef.current) / 1000
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || mimeType || 'audio/webm',
        })
        cleanup()
        // Пустышка (мгновенное нажатие/отпускание) — не считаем записью.
        if (blob.size === 0 || duration < 0.4) {
          setState('idle')
          setElapsed(0)
          return
        }
        setRecorded({ blob, duration })
        setState('recorded')
      }
      recRef.current = rec
      startedAtRef.current = Date.now()
      setElapsed(0)
      rec.start()
      setState('recording')
      timerRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startedAtRef.current) / 1000)
      }, 200)
    } catch {
      cleanup()
      setError('Нет доступа к микрофону')
      setState('idle')
    }
  }, [supported, cleanup])

  const stop = useCallback(() => {
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    setRecorded(null)
    setElapsed(0)
    setError(null)
    setState('idle')
  }, [])

  return { state, elapsed, recorded, supported, error, start, stop, reset }
}
