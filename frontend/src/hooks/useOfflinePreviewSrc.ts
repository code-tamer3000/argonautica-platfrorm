import { useEffect, useState } from 'react'
import { cachePreviewByFetch, getCachedPreviewUrl } from '../lib/attachmentPreviewCache'

/**
 * Src для нативного <img>/<video poster>, который сам по себе не даёт ни прогресса,
 * ни onError-сигнала, пригодного для фолбэка (`<video poster>` вообще не эмитит
 * ошибку загрузки постера ни в одном браузере) — поэтому пробуем загрузку отдельным
 * `Image()`, а не полагаемся на реальный элемент разметки (ARG-149).
 *
 * Онлайн: пробник грузится успешно → сразу отдаём сетевой url и best-effort кэшируем
 * его байты (`cachePreviewByFetch`, попадает в disk-кэш присигненного GET — почти
 * всегда без лишнего похода в сеть, см. lib/attachmentPreviewCache.ts).
 * Офлайн/протухшая подпись: пробник падает → подменяем src на закэшированный blob,
 * если он есть; иначе остаётся сетевой url (обычное «не загрузилось»).
 *
 * `cacheable=false` (легаси-фолбэк на оригинал, url без реального thumb/preview) —
 * хук просто отдаёт src как есть, ничего не кэширует и не подменяет: полноразмерный
 * оригинал в этот кэш не входит (см. «Границы» ARG-149).
 */
export function useOfflinePreviewSrc(url: string | null, cacheable: boolean): string | null {
  const [src, setSrc] = useState(url)

  useEffect(() => {
    setSrc(url)
    if (!url || !cacheable) return
    let cancelled = false
    const probe = new Image()
    probe.onload = () => {
      if (!cancelled) void cachePreviewByFetch(url)
    }
    probe.onerror = () => {
      if (cancelled) return
      void getCachedPreviewUrl(url).then((cached) => {
        if (!cancelled && cached) setSrc(cached)
      })
    }
    probe.src = url
    return () => {
      cancelled = true
    }
  }, [url, cacheable])

  return src
}
