// Byte-level кэш превью вложений в IndexedDB (ARG-149). Диагностика по задаче:
// обычный браузерный HTTP-кэш (ARG-75, presigned-GET стабилен 24ч) не переживает
// связку «kill-процесса → офлайн → холодный релонч» — disk cache Chromium/WebKit
// в этом сценарии на практике недоступен раньше, чем страница успевает нарисовать
// первый кадр (то, что и воспроизвелось руками при постановке задачи). SW-перехват
// (ADR-032) под запретом отдельно — здесь его и нет: обычный `fetch` из main thread,
// без Cache Storage и без вмешательства в сетевой путь самого <img>/<video>, поэтому
// ни один из двух прод-багов ADR-032 (залипший провал навсегда, гонка на cold start
// с самим SW) структурно не воспроизводим.
//
// Кэшируем ТОЛЬКО байты, которые реально долетели до пользователя (thumb_url в
// ленте, preview_url в лайтбоксе/постер видео) — не весь список вложений разом.
// Ключ — pathname URL (presigned-подпись меняется каждую отдачу, uuid объекта в
// пути стабилен, тот же приём, что был в убранном SW-слое, см. ADR-032).
import { idbClear, idbDelete, idbGet, idbGetAll, idbSet, STORE_MEDIA_PREVIEW } from './idb'

// Симметрично убранному workbox-expiration из ADR-032 (60 записей / 7 дней) —
// разумный потолок на устройство, не резиновый рост.
const MAX_ENTRIES = 60
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface Entry {
  blob: Blob
  savedAt: number
}

function cacheKey(url: string): string {
  try {
    return new URL(url, location.origin).pathname
  } catch {
    return url
  }
}

function isFresh(entry: Entry): boolean {
  return Date.now() - entry.savedAt <= MAX_AGE_MS
}

// object-URL живёт, пока вкладка открыта — тот же приём, что в lib/offlinePlaylists.ts,
// чтобы повторный рендер того же превью не плодил новые blob: URL на каждый вызов.
const objectUrlCache = new Map<string, string>()

/** Закэшированный превью-URL для офлайн-фолбэка, если он есть и не протух. */
export async function getCachedPreviewUrl(url: string): Promise<string | null> {
  const key = cacheKey(url)
  const cached = objectUrlCache.get(key)
  if (cached) return cached
  const entry = await idbGet<Entry>(STORE_MEDIA_PREVIEW, key)
  if (!entry || !isFresh(entry)) return null
  const objUrl = URL.createObjectURL(entry.blob)
  objectUrlCache.set(key, objUrl)
  return objUrl
}

async function store(url: string, blob: Blob): Promise<void> {
  const key = cacheKey(url)
  await idbSet(STORE_MEDIA_PREVIEW, key, { blob, savedAt: Date.now() } satisfies Entry)
  await evictOverflow()
}

/**
 * Закэшировать превью по уже готовым байтам (лайтбокс уже качает preview_url целиком
 * через fetch ради прогресс-бара — незачем качать те же байты второй раз).
 */
export async function cachePreviewBlob(url: string, blob: Blob): Promise<void> {
  try {
    const key = cacheKey(url)
    const existing = await idbGet<Entry>(STORE_MEDIA_PREVIEW, key)
    if (existing && isFresh(existing)) return
    await store(url, blob)
  } catch {
    // best-effort — недоступный IndexedDB не должен ронять рендер вложения
  }
}

/**
 * Закэшировать превью, докачав байты отдельным fetch (лента/постер видео рендерят
 * превью нативным <img>/<video poster>, который прогресса/blob'а не даёт). Presigned-
 * URL immutable на 24ч (ARG-75), поэтому fetch на практике бьёт в тот же disk-кэш,
 * что уже обслужил исходный <img> — лишнего сетевого похода почти никогда не будет.
 */
export async function cachePreviewByFetch(url: string): Promise<void> {
  try {
    const key = cacheKey(url)
    const existing = await idbGet<Entry>(STORE_MEDIA_PREVIEW, key)
    if (existing && isFresh(existing)) return
    const res = await fetch(url)
    if (!res.ok) return
    const blob = await res.blob()
    await store(url, blob)
  } catch {
    // офлайн/CORS/протухшая подпись — не критично, это лишь кэш-прогрев
  }
}

async function evictOverflow(): Promise<void> {
  const all = await idbGetAll<Entry>(STORE_MEDIA_PREVIEW)
  const stale = all.filter(({ value }) => !isFresh(value))
  for (const { key } of stale) await idbDelete(STORE_MEDIA_PREVIEW, key)
  const fresh = all.filter(({ value }) => isFresh(value))
  if (fresh.length <= MAX_ENTRIES) return
  const overflow = fresh.sort((a, b) => a.value.savedAt - b.value.savedAt).slice(0, fresh.length - MAX_ENTRIES)
  for (const { key } of overflow) await idbDelete(STORE_MEDIA_PREVIEW, key)
}

/** Логаут: устройство может быть общим, вложения приватные (аналог clearMediaCache). */
export async function clearAttachmentPreviewCache(): Promise<void> {
  try {
    for (const url of objectUrlCache.values()) URL.revokeObjectURL(url)
    objectUrlCache.clear()
    await idbClear(STORE_MEDIA_PREVIEW)
  } catch {
    // best-effort — логаут не должен падать из-за кэша
  }
}
