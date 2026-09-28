import { useEffect, useState } from 'react'
import {
  cachePreviewByFetch,
  getCachedPreviewUrl,
  peekCachedPreviewUrl,
} from '../lib/attachmentPreviewCache'

/**
 * Src для нативного <img>/<video poster>, который сам по себе не даёт ни прогресса,
 * ни onError-сигнала, пригодного для фолбэка (`<video poster>` вообще не эмитит
 * ошибку загрузки постера ни в одном браузере) — поэтому параллельно с реальной
 * загрузкой пробуем отдельный `Image()`, чтобы знать, догрузилось ли (ARG-149).
 *
 * Кэш проверяется ДО сети и имеет приоритет над сырым url (ARG-160): раньше
 * подмена на закэшированный blob срабатывала только по `onerror` пробника — но на
 * слабой (не упавшей полностью) сети запрос не падает с ошибкой, а просто долго
 * тянется, `onerror` не срабатывает вовсе, и уже закэшированные байты не
 * использовались никогда, хотя лежали в IndexedDB. Теперь: синхронный
 * `peekCachedPreviewUrl` (уже открытый в этой вкладке object-URL) решает src для
 * самого первого рендера без единого кадра сырого url, а async `getCachedPreviewUrl`
 * в эффекте докатывает то же самое для кросс-сессионного случая (кэш есть в
 * IndexedDB, но в этой вкладке превью ещё не открывалось) — независимо от исхода
 * сети. Сетевой пробник больше не решает, показывать ли кэш: он только
 * best-effort прогревает/освежает кэш при успехе (`cachePreviewByFetch`) и никогда
 * не подменяет уже показанный кэшированный src обратно на сетевой — байты
 * вложения неизменны, presigned-подпись лишь оборачивает тот же объект.
 *
 * `cacheable=false` (легаси-фолбэк на оригинал, url без реального thumb/preview) —
 * хук просто отдаёт src как есть, ничего не кэширует и не подменяет: полноразмерный
 * оригинал в этот кэш не входит (см. «Границы» ARG-149).
 */
function resolveSrc(url: string | null, cacheable: boolean): string | null {
  return url && cacheable ? peekCachedPreviewUrl(url) ?? url : url
}

export function useOfflinePreviewSrc(url: string | null, cacheable: boolean): string | null {
  const [src, setSrc] = useState(() => resolveSrc(url, cacheable))

  useEffect(() => {
    setSrc(resolveSrc(url, cacheable))
    if (!url || !cacheable) return
    let cancelled = false

    void getCachedPreviewUrl(url).then((cached) => {
      if (!cancelled && cached) setSrc(cached)
    })

    const probe = new Image()
    probe.onload = () => {
      if (!cancelled) void cachePreviewByFetch(url)
    }
    probe.src = url
    return () => {
      cancelled = true
    }
  }, [url, cacheable])

  return src
}
