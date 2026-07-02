// 3-шаговая presigned-загрузка: uploads → PUT в MinIO → assets.
import { http } from './apiClient'
import type { MediaAssetOut, MediaKind, UploadTicket } from './types'

function kindFor(type: string): MediaKind {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  return 'file'
}

function imageDims(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith('image/')) return Promise.resolve({})
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

export async function mediaUpload(file: File): Promise<MediaAssetOut> {
  const kind = kindFor(file.type)
  const ticket = await http.post<UploadTicket>('/api/media/uploads', {
    content_type: file.type,
    size: file.size,
    kind,
  })
  // Прямой PUT клиент → MinIO (минуя бэкенд).
  const put = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new Error('Не удалось загрузить файл в хранилище')
  const dims = await imageDims(file)
  return http.post<MediaAssetOut>('/api/media/assets', {
    storage_key: ticket.storage_key,
    width: dims.width,
    height: dims.height,
  })
}

export function guessMediaKind(url: string): MediaKind {
  const path = url.split('?')[0].toLowerCase()
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return 'image'
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
