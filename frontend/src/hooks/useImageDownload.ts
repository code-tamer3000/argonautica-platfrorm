import { useEffect, useRef, useState } from 'react'

// Скачивание оригинала картинки с ПРОГРЕССОМ (для лайтбокса). Нативный <img src> не
// даёт процента загрузки, поэтому тянем через fetch + ReadableStream: считаем принятые
// байты против Content-Length и отдаём долю 0..1. Готовый blob показываем как object URL.
//
// Best-effort: если сети/поток недоступны, Content-Length нет, или fetch упал —
// откатываемся на прямой src (fallbackUrl), как раньше. Прогресс — удобство, не гейт.

interface State {
  /** URL для <img>: object-URL готового blob, либо исходный (fallback / ещё грузится). */
  src: string
  /** Доля 0..1, пока качаем; null — прогресс недоступен (нет Content-Length / не стартовал). */
  progress: number | null
  /** true, пока идёт загрузка через fetch (показываем полосу). */
  loading: boolean
}

export function useImageDownload(url: string): State {
  const [state, setState] = useState<State>({ src: url, progress: null, loading: true })
  // objectURL для очистки при размонтировании/смене url.
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setState({ src: url, progress: null, loading: true })

    const revoke = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }

    const fallback = () => {
      if (!cancelled) setState({ src: url, progress: null, loading: false })
    }

    async function run() {
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok || !res.body) return fallback()
        const totalHeader = res.headers.get('Content-Length')
        const total = totalHeader ? parseInt(totalHeader, 10) : 0
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            received += value.length
            if (!cancelled && total > 0) {
              setState((s) => ({ ...s, progress: Math.min(1, received / total) }))
            }
          }
        }
        if (cancelled) return
        const blob = new Blob(chunks as BlobPart[])
        revoke()
        const objectUrl = URL.createObjectURL(blob)
        objectUrlRef.current = objectUrl
        setState({ src: objectUrl, progress: 1, loading: false })
      } catch {
        fallback() // abort или сетевая ошибка — прямой src
      }
    }
    void run()

    return () => {
      cancelled = true
      controller.abort()
      revoke()
    }
  }, [url])

  return state
}
