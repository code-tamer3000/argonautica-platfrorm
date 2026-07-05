// 3-шаговая presigned-загрузка: uploads → PUT в MinIO → assets.
import { http } from './apiClient'
import type { MediaAssetOut, MediaKind, UploadTicket } from './types'

function kindFor(type: string): MediaKind {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'file'
}

/**
 * Снять размеры изображения/видео до загрузки. Размеры уедут в media_assets и
 * позволят плееру зарезервировать коробку с верным aspect-ratio ещё до подписи GET
 * (без чёрного прямоугольника и скачка рамок при рендере видео).
 */
function mediaDims(file: File): Promise<{ width?: number; height?: number }> {
  if (file.type.startsWith('image/')) {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
        URL.revokeObjectURL(url)
      }
      img.onerror = () => {
        resolve({})
        URL.revokeObjectURL(url)
      }
      img.src = url
    })
  }
  if (file.type.startsWith('video/')) {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      const url = URL.createObjectURL(file)
      video.onloadedmetadata = () => {
        resolve({ width: video.videoWidth, height: video.videoHeight })
        URL.revokeObjectURL(url)
      }
      video.onerror = () => {
        resolve({})
        URL.revokeObjectURL(url)
      }
      video.preload = 'metadata'
      video.src = url
    })
  }
  return Promise.resolve({})
}

const POSTER_MAX_PX = 1024 // как серверные превью картинок — постер лёгкий

/**
 * Снять постер-кадр видео на клиенте: перематываем чуть вперёд (первый кадр часто
 * чёрный), рисуем на canvas, отдаём WebP-Blob. Так у видео в ленте есть превью, не
 * таща сам файл на бэкенд. Best-effort — при любой заминке (кодек не декодится в
 * фоне, нет 2d-контекста, таймаут) возвращаем null: видео просто останется без
 * постера. Файл локальный (object URL), canvas не «портится» CORS — читать можно.
 */
function capturePoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false
    const done = (blob: Blob | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(blob)
    }
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onloadeddata = () => {
      // Небольшой сдвиг от нуля — уводит от чёрного стартового кадра.
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2)
    }
    video.onseeked = () => {
      try {
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) return done(null)
        const scale = Math.min(1, POSTER_MAX_PX / Math.max(w, h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return done(null)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => done(blob), 'image/webp', 0.8)
      } catch {
        done(null)
      }
    }
    video.onerror = () => done(null)
    video.src = url
    // Подстраховка: не ждём вечно, если кадр так и не пришёл.
    setTimeout(() => done(null), 10_000)
  })
}

/**
 * Залить постер видео в MinIO как отдельный объект и вернуть его storage_key (его
 * подхватит confirm как thumb_storage_key). Свой media_assets постеру НЕ создаём —
 * не зовём `/assets`. Best-effort: null при любой ошибке (постер не критичен).
 */
async function uploadPoster(blob: Blob): Promise<string | null> {
  try {
    const contentType = blob.type || 'image/webp'
    const ticket = await http.post<UploadTicket>('/api/media/uploads', {
      content_type: contentType,
      size: blob.size,
      kind: 'image' as MediaKind,
    })
    await putWithProgress(ticket.upload_url, blob, contentType)
    return ticket.storage_key
  } catch {
    return null
  }
}

/** Прогресс загрузки: доля 0..1. Вызывается по мере отправки байтов в MinIO. */
export type UploadProgress = (fraction: number) => void

/**
 * PUT файла в MinIO с отслеживанием прогресса. fetch не отдаёт upload-прогресс,
 * поэтому используем XMLHttpRequest (upload.onprogress).
 */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: UploadProgress,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1)
        resolve()
      } else {
        reject(new Error(`Не удалось загрузить файл в хранилище (код ${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Не удалось загрузить файл в хранилище'))
    xhr.onabort = () => reject(new Error('Загрузка отменена'))
    xhr.send(body)
  })
}

export async function mediaUpload(
  file: File,
  onProgress?: UploadProgress,
): Promise<MediaAssetOut> {
  const kind = kindFor(file.type)
  const ticket = await http.post<UploadTicket>('/api/media/uploads', {
    content_type: file.type,
    size: file.size,
    kind,
  })
  // Прямой PUT клиент → MinIO (минуя бэкенд) с прогрессом.
  await putWithProgress(ticket.upload_url, file, file.type, onProgress)
  const dims = await mediaDims(file)
  // Видео: снимаем и заливаем постер-кадр (превью для ленты). Не блокирует загрузку —
  // если не собрался, thumb_storage_key останется пустым и видео будет без постера.
  let thumbStorageKey: string | undefined
  if (kind === 'video') {
    const poster = await capturePoster(file)
    if (poster) thumbStorageKey = (await uploadPoster(poster)) ?? undefined
  }
  return http.post<MediaAssetOut>('/api/media/assets', {
    storage_key: ticket.storage_key,
    width: dims.width,
    height: dims.height,
    thumb_storage_key: thumbStorageKey,
  })
}

/**
 * Загрузка голосового сообщения (тот же 3-шаговый presigned-поток, что и файлы).
 *
 * У записанного Blob нет имени, а `.type` несёт кодек (`audio/webm;codecs=opus`) —
 * поэтому оборачиваем в File с явным типом и прокидываем длительность (секунды) в
 * confirm: она уедет в `media_assets.duration` и покажется в плеере до подписи GET.
 */
export async function voiceUpload(
  blob: Blob,
  durationSec: number,
  onProgress?: UploadProgress,
): Promise<MediaAssetOut> {
  const contentType = blob.type || 'audio/webm'
  const ticket = await http.post<UploadTicket>('/api/media/uploads', {
    content_type: contentType,
    size: blob.size,
    kind: 'audio' as MediaKind,
  })
  await putWithProgress(ticket.upload_url, blob, contentType, onProgress)
  return http.post<MediaAssetOut>('/api/media/assets', {
    storage_key: ticket.storage_key,
    duration: Math.max(1, Math.round(durationSec)),
  })
}

export function guessMediaKind(url: string): MediaKind {
  const path = url.split('?')[0].toLowerCase()
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return 'image'
  // Аудио проверяем ДО видео: расширения webm/ogg/mp4 неоднозначны между аудио и
  // видео — по URL их не различить. Поэтому Attachment полагается на явный kind из
  // media_assets (assetKind), а этот эвристический разбор оставляем как фолбэк.
  if (/\.(mp3|m4a|aac|wav|oga|opus|weba)$/.test(path)) return 'audio'
  if (/\.(mp4|webm|mov|m4v|ogg)$/.test(path)) return 'video'
  return 'file'
}

/** Имя файла из presigned-URL (последний сегмент пути до query). */
export function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.split('/').pop() || 'file')
  } catch {
    return 'file'
  }
}

/**
 * Надёжное скачивание presigned-файла на мобиле и в PWA.
 *
 * Кросс-доменный `<a download>` браузеры игнорируют, а `target=_blank` в iOS-PWA
 * (standalone) открывает пустую вкладку без скачивания. Поэтому тянем файл как blob
 * (same-origin blob: URL), у которого `download` работает везде, и кликаем по нему.
 * Фолбэк на прямой переход по ссылке — если fetch не удался (напр. CORS).
 */
export async function downloadFile(url: string, filename?: string): Promise<void> {
  const name = filename || fileNameFromUrl(url)
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Даём браузеру начать скачивание, потом освобождаем память.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
  } catch {
    // Последняя попытка: обычный переход (presigned уже несёт attachment-disposition).
    window.open(url, '_blank', 'noopener')
  }
}
