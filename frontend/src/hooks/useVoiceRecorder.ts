import { useCallback, useEffect, useRef, useState } from 'react'

// Opus предпочтителен, MP4/AAC нужен для Safari.
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

interface RecordedVoice {
  blob: Blob
  duration: number
}

type RecorderState =
  | { phase: 'idle' | 'requesting' | 'stopping' }
  | { phase: 'recording'; startedAt: number }
  | { phase: 'recorded'; voice: RecordedVoice }

interface Session {
  chunks: BlobPart[]
  startedAt: number
  stoppedAt?: number
  stream?: MediaStream
  recorder?: MediaRecorder
  context?: AudioContext
  readLevel?: () => number
}

function connectMeter(context: AudioContext, stream: MediaStream) {
  const analyser = context.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0
  context.createMediaStreamSource(stream).connect(analyser)
  const bins = new Uint8Array(analyser.frequencyBinCount)

  return () => {
    analyser.getByteFrequencyData(bins)
    let level = 0
    for (let i = 1; i < 33; i += 1) level += bins[i]
    return Math.min(1, (level * 2.2) / (32 * 255))
  }
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>({ phase: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<Session | null>(null)

  const supported =
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia

  const cleanup = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    if (!session) return
    if (session.recorder) {
      session.recorder.ondataavailable = null
      session.recorder.onstop = null
      session.recorder.onerror = null
      if (session.recorder.state !== 'inactive') session.recorder.stop()
    }
    session.stream?.getTracks().forEach((track) => track.stop())
    void session.context?.close().catch(() => {})
  }, [])

  useEffect(() => cleanup, [cleanup])

  const reset = useCallback(() => {
    cleanup()
    setError(null)
    setState({ phase: 'idle' })
  }, [cleanup])

  function resumeMeter() {
    const context = sessionRef.current?.context
    if (context?.state === 'suspended') void context.resume().catch(() => {})
  }

  async function start() {
    if (sessionRef.current) return
    const session: Session = { chunks: [], startedAt: 0 }
    sessionRef.current = session
    setError(null)
    setState({ phase: 'requesting' })

    // Создаём контекст во время жеста. Если Web Audio недоступен, запись всё равно работает.
    try {
      session.context = new AudioContext()
      resumeMeter()
    } catch {
      // MediaRecorder не зависит от Web Audio.
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (sessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      session.stream = stream
      const mimeType = CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      session.recorder = recorder
      recorder.ondataavailable = ({ data }) => {
        if (data.size) session.chunks.push(data)
      }
      recorder.onstop = () => {
        if (sessionRef.current !== session) return
        const duration = ((session.stoppedAt ?? performance.now()) - session.startedAt) / 1000
        const blob = new Blob(session.chunks, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        })
        cleanup()
        // Очень короткая запись может не содержать звуковых данных.
        if (!blob.size || duration < 0.4) {
          setState({ phase: 'idle' })
          return
        }
        setState({ phase: 'recorded', voice: { blob, duration } })
      }
      recorder.onerror = () => {
        reset()
        setError('Не удалось записать голосовое')
      }
      if (session.context) {
        try {
          session.readLevel = connectMeter(session.context, stream)
        } catch {
          // Предпрослушивание и отправка доступны даже без волны.
        }
      }
      recorder.start()
      session.startedAt = performance.now()
      setState({ phase: 'recording', startedAt: session.startedAt })
    } catch {
      if (sessionRef.current !== session) return
      reset()
      setError('Нет доступа к микрофону')
    }
  }

  function stop() {
    const session = sessionRef.current
    if (!session) return
    if (!session.recorder) {
      reset()
      return
    }
    if (session.recorder.state === 'inactive') return
    session.stoppedAt = performance.now()
    session.recorder.stop()
    setState({ phase: 'stopping' })
  }

  const readLevel = useCallback(() => sessionRef.current?.readLevel?.() ?? 0, [])

  return { state, supported, error, start, stop, reset, readLevel, resumeMeter }
}
