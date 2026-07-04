import { useEffect, useRef, useState } from 'react'

export interface MediaProgress {
  /** Готовый blob:-URL (тело скачано целиком) или null, пока грузится. */
  objectUrl: string | null
  /** Доля 0..1, если известен Content-Length; иначе null (крутилка без %). */
  progress: number | null
  /** fetch не удался (напр. CORS/сеть) — вызывающий откатывается на прямой <img src>. */
  failed: boolean
}

/**
 * Скачать медиа по presigned-URL с прогрессом.
 *
 * `<img src>`/`<video src>` не дают событий прогресса, поэтому тянем файл через
 * `fetch` + ReadableStream: по Content-Length считаем долю и собираем blob, который
 * потом отдаём тегу. Работает только если MinIO отвечает с CORS (см. put_bucket_cors);
 * при любой ошибке выставляем `failed` — вызывающий рендерит обычный `<img src=url>`
 * (для картинок CORS не нужен) с индикатором-крутилкой без процента.
 *
 * Подходит для картинок (качаются целиком всё равно). Видео так тянуть не стоит —
 * потеряется потоковость и перемотка; для видео крутилку показываем по нативным
 * событиям загрузки, а этот хук не используем.
 */
export function useMediaProgress(url: string | undefined): MediaProgress {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const blobRef = useRef<string | null>(null)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    const ctrl = new AbortController()
    setObjectUrl(null)
    setProgress(null)
    setFailed(false)

    ;(async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const total = Number(res.headers.get('Content-Length')) || 0
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let loaded = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          loaded += value.length
          if (total > 0 && !cancelled) setProgress(loaded / total)
        }
        if (cancelled) return
        const blob = new Blob(chunks as BlobPart[])
        const objUrl = URL.createObjectURL(blob)
        blobRef.current = objUrl
        setProgress(1)
        setObjectUrl(objUrl)
      } catch (e) {
        if (!cancelled && (e as Error).name !== 'AbortError') setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      ctrl.abort()
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current)
        blobRef.current = null
      }
    }
  }, [url])

  return { objectUrl, progress, failed }
}
