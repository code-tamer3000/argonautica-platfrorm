import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type RefObject } from 'react'

const BARS = 44
const MAX_SECONDS = 10 * 60
const MAX_BYTES = 12 * 1024 * 1024

// Keep at most one download and decode in flight when a page of messages appears.
let pending: Promise<unknown> = Promise.resolve()

async function readAudio(src: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timeout = window.setTimeout(abort, 20_000)
  try {
    const response = await fetch(src, { signal: controller.signal })
    if (!response.ok) throw new Error('Could not load audio for waveform')
    if (!response.body || Number(response.headers.get('Content-Length')) > MAX_BYTES) {
      abort()
      return null
    }
    // A stream cap covers responses without a Content-Length header.
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {
        abort()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes.buffer
  } finally {
    window.clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}

function measureLoudness(audio: AudioBuffer) {
  const bars = Array<number>(BARS).fill(0)
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const samples = audio.getChannelData(channel)
    for (let i = 0; i < BARS; i += 1) {
      const start = Math.floor(i * samples.length / BARS)
      const end = Math.floor((i + 1) * samples.length / BARS)
      const stride = Math.max(1, Math.floor((end - start) / 1024))
      let energy = 0
      let count = 0
      for (let frame = start; frame < end; frame += stride) {
        energy += samples[frame] ** 2
        count += 1
      }
      if (count) bars[i] = Math.max(bars[i], Math.sqrt(energy / count))
    }
  }
  const max = Math.max(0.035, ...bars)
  return bars.map((value) => Math.sqrt(value / max))
}

function queueWaveform(src: string, signal: AbortSignal) {
  const job = pending.then(async () => {
    if (signal.aborted) return null
    const bytes = await readAudio(src, signal)
    if (!bytes || signal.aborted) return null
    const decoder = new OfflineAudioContext(1, 1, 8000)
    const audio = await decoder.decodeAudioData(bytes)
    if (audio.duration > MAX_SECONDS) return null
    return measureLoudness(audio)
  })
  pending = job.catch(() => {})
  return job
}

function sourceKey(src: string) {
  const url = new URL(src, window.location.href)
  if (url.protocol === 'blob:') return src
  return url.origin + url.pathname
}

export function useVoiceWaveform(
  rootRef: RefObject<HTMLDivElement>,
  src: string | null,
  duration: number,
) {
  const [visible, setVisible] = useState(false)
  const eligible = !!src && duration > 0 && duration <= MAX_SECONDS &&
    typeof OfflineAudioContext !== 'undefined'

  useEffect(() => {
    const root = rootRef.current
    if (!eligible || !root) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    let timer: number | undefined
    const observer = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timer)
      if (entry.isIntersecting) timer = window.setTimeout(() => setVisible(true), 200)
      else setVisible(false)
    })
    observer.observe(root)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [eligible, rootRef])

  const query = useQuery({
    queryKey: ['voice-waveform', src ? sourceKey(src) : null],
    queryFn: ({ signal }) => src ? queueWaveform(src, signal) : null,
    enabled: eligible && visible,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  return eligible ? query.data : null
}
