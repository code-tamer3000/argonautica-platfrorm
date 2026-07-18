// Рантайм-кэш медиа: общие константы и хелперы для service worker (пишет кэш)
// и приложения (сносит кэш на логауте). Отдельный модуль, потому что sw.ts
// типизируется своим tsconfig (WebWorker) и импортировать из него в UI нельзя.
//
// ЗАЧЕМ ВООБЩЕ КЭШ. Медиа отдаётся по presigned-URL (SigV4): в query сидят
// `X-Amz-Date` (посекундная точность) и производная `X-Amz-Signature`, поэтому
// ДВА показа одного и того же объекта — это два РАЗНЫХ URL. Браузер кэширует по
// полному URL вместе с query, так что HTTP-кэш не попадал никогда, сколько бы
// правильных `Cache-Control: immutable` nginx ни отдавал: одна фотография 11 МБ
// давала 182 МБ трафика за сессию. Лечится только своим ключом без query.

/** Имя кэша в Cache Storage. Меняем суффикс, если формат ключа станет несовместим. */
export const MEDIA_CACHE_NAME = 'arg-media-v1'

/** Пути, по которым nginx отдаёт медиа (тот же origin, что и приложение). */
export function isMediaPath(pathname: string): boolean {
  return pathname.startsWith('/chat-media/') || pathname.startsWith('/kb-media/')
}

/**
 * Стабильный ключ кэша: origin + pathname, БЕЗ query и хэша.
 *
 * Ключ объекта содержит uuid (`YYYY/MM/<uuid>.<ext>`, превью — `previews/<key>.webp`),
 * то есть pathname уникален и неизменяем: один pathname = одни и те же байты навсегда.
 * Отбрасывая подпись, мы склеиваем все пересозданные presigned-URL одного объекта
 * в одну запись кэша — именно это и чинит промахи.
 */
export function mediaCacheKey(rawUrl: string): string {
  const u = new URL(rawUrl)
  return `${u.origin}${u.pathname}`
}

/**
 * Снести кэш медиа (логаут: устройство может быть общим, картинки приватные).
 * Best-effort: без Cache API / в приватном режиме просто ничего не делаем —
 * логаут не должен падать из-за кэша.
 */
export async function clearMediaCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    await caches.delete(MEDIA_CACHE_NAME)
  } catch {
    // no-op
  }
}
