// Клиентское сжатие фото ПЕРЕД заливкой в MinIO.
//
// Зачем: метрики прода показали ДВЕ боли по фото, а не одну.
//   - upload: телефонные фото 2–4 МБ льются в аплинк (~3–6 Mbps) — тот же боттлнек,
//     что у видео, только чаще (фото шлют больше всего).
//   - download: несжатый оригинал качают ЦЕЛИКОМ (png/jpg avg 1.5–4 с, хвост до 100 с),
//     тогда как webp-превью летают за 0.1 с. Оригинал грузится по клику в лайтбоксе.
// Уменьшив байты ОДИН раз на клиенте, чиним обе стороны: и заливку, и последующую
// отдачу этого же объекта. Картинке хватает <canvas> + toBlob (без MediaRecorder).
// Видео на клиенте НЕ сжимаем — его транскодит сервер (см. docs/FILES.md).
//
// Как (без внешних зависимостей): <img>/createImageBitmap декодит исходник → рисуем
// на уменьшенный <canvas> → canvas.toBlob(webp|jpeg, q) даёт сжатый blob. EXIF-поворот
// современные браузеры применяют к декодированному изображению сами (image-orientation:
// from-image по умолчанию), поэтому canvas получает уже правильно ориентированный кадр.
//
// iOS PWA Safari — основной мобильный доступ, поэтому ВСЁ под фичедетектом и best-effort:
// нет toBlob/canvas, кодек не поддержан, «сжатый» вышел не меньше исходного, любая
// ошибка/таймаут → возвращаем null, вызывающий льёт ОРИГИНАЛ. Фото не теряется никогда.

/** Результат успешного сжатия: перекодированный blob + его mime и размеры. */
export interface ImageCompressResult {
  blob: Blob
  mimeType: string
  width: number
  height: number
}

// Ниже этого размера фото НЕ трогаем: мелкая картинка уже лёгкая, перекодирование
// съело бы CPU/время без ощутимой выгоды для аплинка. Порог — в байтах.
export const IMAGE_COMPRESS_THRESHOLD_BYTES = 1 * 1024 * 1024 // ~1 МБ

// Целевой потолок бо́льшей стороны. 2048px с запасом хватает и ленте, и лайтбоксу на
// телефоне (Retina), но режет мегапиксели телефонной камеры (4000×3000+) в разы.
// Меньшую сторону считаем пропорционально; если фото уже ≤ этого — не апскейлим.
const TARGET_MAX_DIMENSION = 2048

// Качество перекодирования. 0.82 WebP визуально почти неотличим от оригинала на фото,
// но заметно легче JPEG той же картинки.
const TARGET_QUALITY = 0.82

// Формат вывода: WebP — лучший размер/качество, поддержан во всех целевых браузерах
// (Safari 14+, все Chromium). Фолбэк на JPEG, если toBlob не отдаёт webp (очень старый
// WebView). PNG на выходе не делаем — для фото он тяжелее без выигрыша.
const OUTPUT_WEBP = 'image/webp'
const OUTPUT_JPEG = 'image/jpeg'

// SVG не растеризуем (потеряем векторность и прозрачность-как-задумано); GIF может быть
// анимированным — canvas сплющил бы его в один кадр. Эти типы пропускаем без сжатия.
const SKIP_MIME = new Set(['image/svg+xml', 'image/gif'])

/**
 * Поддерживает ли платформа наш путь сжатия в принципе (быстрый фичедетект без
 * декодирования файла). Проверяем canvas + toBlob. Не гарантирует успех (кодек может
 * не отдать нужный mime), но отсекает заведомо неспособные окружения.
 */
export function canCompressImage(): boolean {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  return typeof canvas.toBlob === 'function' && typeof canvas.getContext === 'function'
}

/** Стоит ли вообще пытаться сжать этот файл (тип/размер). */
export function shouldCompressImage(file: File): boolean {
  if (!file.type.startsWith('image/')) return false
  if (SKIP_MIME.has(file.type)) return false
  if (file.size < IMAGE_COMPRESS_THRESHOLD_BYTES) return false
  return canCompressImage()
}

/** Целевые размеры: ужать бо́льшую сторону до TARGET_MAX_DIMENSION, не апскейлить. */
function targetDims(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(1, TARGET_MAX_DIMENSION / Math.max(w, h))
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

/** canvas.toBlob как промис; null при отказе кодека для этого mime/качества. */
function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), mime, quality)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Декодировать файл в источник для canvas. createImageBitmap быстрее и не грузит DOM,
 * но есть не везде; фолбэк на <img> + object URL. Оба применяют EXIF-ориентацию
 * (imageOrientation:'from-image' у bitmap; дефолт image-orientation у <img>).
 */
async function decode(
  file: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // старый WebView / неподдержанный формат — падаем на <img>
    }
  }
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/**
 * Сжать фото до ≤TARGET_MAX_DIMENSION в WebP (фолбэк JPEG). Возвращает сжатый blob
 * или null, если сжать не удалось/бессмысленно (тогда вызывающий льёт оригинал).
 * НИКОГДА не бросает — любая ошибка сворачивается в null.
 */
export async function compressImage(file: File): Promise<ImageCompressResult | null> {
  if (!canCompressImage()) return null
  let decoded: Awaited<ReturnType<typeof decode>> = null
  try {
    decoded = await decode(file)
    if (!decoded || !decoded.width || !decoded.height) return null

    const { width, height } = targetDims(decoded.width, decoded.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(decoded.source, 0, 0, width, height)

    // WebP предпочтительно; если браузер не отдал webp-blob — пробуем JPEG.
    let mimeType = OUTPUT_WEBP
    let blob = await canvasToBlob(canvas, mimeType, TARGET_QUALITY)
    if (!blob || !blob.type.includes('webp')) {
      mimeType = OUTPUT_JPEG
      blob = await canvasToBlob(canvas, mimeType, TARGET_QUALITY)
    }
    if (!blob || blob.size === 0) return null

    // Защита от бессмысленного сжатия: если «сжатый» не меньше исходного (уже сильно
    // пожатый JPEG, крошечная картинка) — откат на оригинал.
    if (blob.size >= file.size) return null

    return { blob, mimeType, width, height }
  } catch {
    return null
  } finally {
    decoded?.close()
  }
}
