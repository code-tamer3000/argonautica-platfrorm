// Рантайм-кэш медиа: общие константы и хелперы для service worker (пишет кэш)
// и приложения (сносит кэш на логауте). Отдельный модуль, потому что sw.ts
// типизируется своим tsconfig (WebWorker) и импортировать из него в UI нельзя.
//
// ЗАЧЕМ ВООБЩЕ ЭТОТ (второй) СЛОЙ КЭША. Медиа отдаётся по presigned-URL (SigV4):
// в query сидят `X-Amz-Date`/`X-Amz-Signature`. Раньше момент подписи брался
// посекундно, поэтому ДВА показа одного объекта давали два РАЗНЫХ URL, и обычный
// браузерный HTTP-кэш (ключ = полный URL с query) не попадал никогда — одна
// фотография 11 МБ давала 182 МБ трафика за сессию. С ARG-75 backend округляет
// момент подписи вниз до суточного окна (`PRESIGN_GET_WINDOW`, services/media.py),
// поэтому URL одного объекта теперь стабилен весь день и обычный HTTP-кэш
// (docs/FRONTEND.md «Media cache, two layers») сам покрывает картинки/видео/аудио.
// Этот SW-слой остаётся вторым эшелоном для картинок same-origin: не зависит от
// стабильности подписи вообще (ключ без query) и не ограничен суточным окном.

/**
 * Имя кэша в Cache Storage. Меняем суффикс, если формат ключа станет несовместим,
 * ИЛИ чтобы разово сбросить у всех уже испорченные записи (см. cacheWillUpdate
 * в sw.ts — до этой версии кэш мог сохранить неудачный ответ навсегда).
 */
export const MEDIA_CACHE_NAME = 'arg-media-v2'

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
