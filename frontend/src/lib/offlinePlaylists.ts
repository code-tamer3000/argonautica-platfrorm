import { idbClear, idbGet, idbSet, STORE_PLAYLIST_OFFLINE } from './idb'
import type { PlaylistOut } from './types'

// Офлайн-прослушивание плейлистов (ARG-145). Скачанные байты трека лежат в
// IndexedDB по media_asset_id (см. lib/idb.ts) — один и тот же файл, встреченный
// в двух плейлистах, скачивается один раз. Здесь же — крошечный in-memory кэш
// object-URL: GlobalPlayer сравнивает `el.src` с новым значением, чтобы понять,
// сменился ли трек (docs/FILES.md «Плейлист»), а `URL.createObjectURL` на каждый
// вызов возвращает НОВУЮ строку для того же Blob — без кэша плеер решил бы, что
// трек каждый раз меняется, и перезапускал воспроизведение с нуля.
const objectUrlCache = new Map<number, string>()

export async function isAssetDownloaded(assetId: number): Promise<boolean> {
  const blob = await idbGet<Blob>(STORE_PLAYLIST_OFFLINE, assetId)
  return blob != null
}

export async function isPlaylistDownloaded(playlist: PlaylistOut): Promise<boolean> {
  if (playlist.tracks.length === 0) return false
  const flags = await Promise.all(playlist.tracks.map((t) => isAssetDownloaded(t.asset_id)))
  return flags.every(Boolean)
}

/** Локальный blob-URL трека, если он скачан для офлайна — иначе null (вызывающий сам падает на presigned-URL). */
export async function getOfflineTrackUrl(assetId: number): Promise<string | null> {
  const cached = objectUrlCache.get(assetId)
  if (cached) return cached
  const blob = await idbGet<Blob>(STORE_PLAYLIST_OFFLINE, assetId)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  objectUrlCache.set(assetId, url)
  return url
}

/**
 * Качает все треки подборки байтами и кладёт их в IndexedDB. Идемпотентна —
 * трек, уже лежащий в сторе (в т.ч. с прошлой прерванной попытки), повторно не
 * качается, так что прерванное на середине скачивание можно просто повторить.
 */
export async function downloadPlaylist(
  playlist: PlaylistOut,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = playlist.tracks.length
  let done = 0
  onProgress?.(done, total)
  for (const track of playlist.tracks) {
    if (!(await isAssetDownloaded(track.asset_id))) {
      const res = await fetch(track.url)
      if (!res.ok) throw new Error(`Не удалось скачать «${track.title}»`)
      const blob = await res.blob()
      await idbSet(STORE_PLAYLIST_OFFLINE, track.asset_id, blob)
    }
    done += 1
    onProgress?.(done, total)
  }
}

/** Логаут: устройство может быть общим, скачанные треки — не более публичные, чем presigned-URL. */
export async function clearOfflinePlaylists(): Promise<void> {
  for (const url of objectUrlCache.values()) URL.revokeObjectURL(url)
  objectUrlCache.clear()
  await idbClear(STORE_PLAYLIST_OFFLINE)
}
