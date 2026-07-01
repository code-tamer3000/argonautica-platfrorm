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
