// 3-шаговая presigned-загрузка: uploads → PUT в MinIO → assets.
import { http } from './apiClient'
import { compressImage, shouldCompressImage } from './imageCompress'
import { MediaTracer, reportMetric } from './metrics'
import type { MediaAssetOut, MediaKind, UploadTicket } from './types'

function kindFor(type: string): MediaKind {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'file'
}

/**
 * The MIME type to upload with. Browsers report `.md` inconsistently (empty or
 * `application/octet-stream` on many OSes), which the backend allow-list rejects,
 * so fall back to `text/markdown` by extension. The KB chapter reader relies on
 * `.md` files being uploadable.
 */
function contentTypeFor(file: File): string {
  const isMdType = /^text\/(x-)?markdown$/i.test(file.type)
  if (!isMdType && /\.(md|markdown)$/i.test(file.name)) return 'text/markdown'
  return file.type
}

/**
 * Снять размеры изображения/видео до загрузки. Размеры уедут в media_assets и
 * позволят плееру зарезервировать коробку с верным aspect-ratio ещё до подписи GET
 * (без чёрного прямоугольника и скачка рамок при рендере видео).
 */
function mediaDims(file: Blob): Promise<{ width?: number; height?: number }> {
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
function capturePoster(file: Blob): Promise<Blob | null> {
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
 *
 * `signal` — необязательная отмена (юзер жмёт «Отменить»): при abort рвём XHR, и
 * промис реджектится AbortError (`xhr.onabort`). Уже сработавший abort — сразу reject.
 */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Загрузка отменена', 'AbortError'))
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    if (signal) {
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1)
        resolve()
      } else if (xhr.status === 403 || xhr.status === 400) {
        // Протухшая подпись presigned-PUT: заливка шла дольше её срока жизни (час) —
        // на очень медленном канале с очень большим файлом. MinIO рвёт с 403/400
        // AccessDenied. Даём понятную причину, а не голый код: файл велик для канала.
        reject(
          new Error(
            'Загрузка длилась слишком долго и прервалась. Попробуйте файл поменьше ' +
              'или более быструю сеть.',
          ),
        )
      } else {
        reject(new Error(`Не удалось загрузить файл в хранилище (код ${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Не удалось загрузить файл в хранилище'))
    xhr.onabort = () => reject(new DOMException('Загрузка отменена', 'AbortError'))
    xhr.send(body)
  })
}

/**
 * Ассет + локальный blob исходного файла. Blob нужен вызывающему коду чата, чтобы
 * положить байты в outbox (IndexedDB) и рисовать превью из `blob:`-URL, переживающего
 * перезагрузку, пока сообщение ещё в очереди (см. lib/outbox.ts).
 */
export interface UploadResult {
  asset: MediaAssetOut
  blob: Blob
}

/** true, если ошибка — отмена загрузки (AbortController). Вызывающий гасит тост. */
export function isUploadAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export async function mediaUpload(
  file: File,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
): Promise<UploadResult> {
  // Подготовка (размеры/постер) сети не касается и отмену не поддерживает — сжатие
  // видео, единственный отменяемый шаг, убрали. signal нужен только сетевой заливке.
  const pending = await preparePendingUpload(file)
  const asset = await runPendingUpload(pending, onProgress, signal)
  return { asset, blob: file }
}

/**
 * Загрузка голосового сообщения (тот же 3-шаговый presigned-поток, что и файлы).
 *
 * У записанного Blob нет имени, а `.type` несёт кодек (`audio/webm;codecs=opus`) —
 * поэтому прокидываем длительность (секунды) в confirm: она уедет в
 * `media_assets.duration` и покажется в плеере до подписи GET.
 */
export async function voiceUpload(
  blob: Blob,
  durationSec: number,
  onProgress?: UploadProgress,
): Promise<UploadResult> {
  const pending = await preparePendingVoice(blob, durationSec)
  const asset = await runPendingUpload(pending, onProgress)
  return { asset, blob }
}

// ───────────────────── Отложенная загрузка (offline outbox) ─────────────────────
//
// mediaUpload/voiceUpload заливают файл СРАЗУ и лишь потом ставят сообщение в outbox,
// поэтому без сети они падают ещё ДО очереди — вложение теряется («fail load» у файла,
// пропавший кружок у голосового). Это ломало обещание «сообщение с файлом/голосом
// сохраняется без интернета».
//
// Поэтому расщепляем поток на две фазы:
//   1) prepare* — БЕЗ сети: снимаем размеры/постер локально, кладём сырой blob в
//      описатель PendingUpload (его сериализуем в IndexedDB, показываем blob:-превью).
//   2) runPendingUpload — сетевые шаги (ticket → PUT → asset). Их гоняет воркер
//      outbox'а с ретраями/ожиданием online ПЕРЕД отправкой самого сообщения.

/**
 * Сырое вложение, готовое к отложенной заливке: байты (`blob`) + всё для confirm'а
 * ассета (kind/mime/размеры/длительность) + опциональный постер видео. Blob и
 * posterBlob переживают structured clone в IndexedDB.
 */
export interface PendingUpload {
  blob: Blob
  contentType: string
  kind: MediaKind
  width?: number
  height?: number
  duration?: number
  posterBlob?: Blob
}

/**
 * Крупное фото сжать на клиенте ПЕРЕД заливкой (≤2048px, WebP) — бьёт сразу по двум
 * болям с прода: медленный аплинк (меньше байт в PUT) И медленная отдача оригинала по
 * клику (тот же объект легче качать). См. imageCompress.ts. Возвращает {blob,contentType}:
 * сжатый — если получилось, иначе оригинал. Мелкое фото (< порога), svg/gif и
 * неподдерживающие платформы идут как есть. Замер до/после уходит метрикой
 * (op=upload, kind=image, step=compress) — виден эффект, как у видео.
 */
async function maybeCompressImage(
  file: File,
): Promise<{ blob: Blob; contentType: string }> {
  const original = { blob: file as Blob, contentType: contentTypeFor(file) }
  if (!shouldCompressImage(file)) return original
  const t0 = performance.now()
  let result: Awaited<ReturnType<typeof compressImage>> = null
  try {
    result = await compressImage(file)
  } catch {
    result = null // сжатие best-effort: любой сбой → льём оригинал
  }
  const elapsed = performance.now() - t0
  const outBytes = result?.blob.size ?? file.size
  // Метрика длительности сжатия (мс-гистограмма на бэкенде). size — исходный вес, чтобы
  // перцентиль compress соотносился с ним; эффект по размеру виден по падению `size` в
  // client:upload:image:put (там size = размер заливаемого blob). Зеркало видео-метрики.
  reportMetric({
    op: 'upload',
    kind: 'image',
    size: file.size,
    total_ms: elapsed,
    steps: { compress_ms: elapsed },
  })
  if (import.meta.env.DEV) {
    const pct = Math.round((1 - outBytes / file.size) * 100)
    console.info(
      `[image] compress ${(file.size / 1e6).toFixed(1)}→${(outBytes / 1e6).toFixed(1)} MB ` +
        `(-${pct}%) in ${Math.round(elapsed)}ms${result ? '' : ' (fallback: original)'}`,
    )
  }
  if (!result) return original
  return { blob: result.blob, contentType: result.mimeType }
}

/**
 * Файл из проводника → описатель отложенной заливки (размеры/постер сняты локально).
 *
 * Видео БОЛЬШЕ НЕ сжимаем в браузере: перекодирование через MediaRecorder било по
 * батарее/памяти и заставляло ждать ДО начала заливки. Теперь льём ОРИГИНАЛ сразу,
 * а сервер транскодит его в фоне (H.264 720p + faststart) — см. docs/FILES.md. Фото
 * по-прежнему ужимаем на клиенте (дёшево, бьёт и по аплинку, и по отдаче оригинала).
 * Постер видео снимаем локально (мгновенное превью в processing-состоянии); сервер
 * потом сгенерит свой как фолбэк/для консистентности.
 */
export async function preparePendingUpload(file: File): Promise<PendingUpload> {
  const kind = kindFor(contentTypeFor(file))
  let blob: Blob
  let contentType: string
  if (kind === 'image') {
    // Фото ужимаем ДО снятия размеров — они должны описывать реально заливаемый blob.
    ;({ blob, contentType } = await maybeCompressImage(file))
  } else {
    blob = file
    contentType = contentTypeFor(file)
  }
  const dims = await mediaDims(blob)
  let posterBlob: Blob | undefined
  if (kind === 'video') {
    posterBlob = (await capturePoster(blob)) ?? undefined
  }
  return { blob, contentType, kind, width: dims.width, height: dims.height, posterBlob }
}

/** Записанное голосовое → описатель отложенной заливки. */
export async function preparePendingVoice(
  blob: Blob,
  durationSec: number,
): Promise<PendingUpload> {
  return {
    blob,
    contentType: blob.type || 'audio/webm',
    kind: 'audio',
    duration: Math.max(1, Math.round(durationSec)),
  }
}

/**
 * Сетевые шаги отложенной заливки: presigned ticket → PUT в MinIO → confirm ассета.
 * Постер видео (если снят) льём отдельным объектом — best-effort. Гоняется воркером
 * outbox'а; при офлайне/ошибке бросает — воркер ретраит.
 */
export async function runPendingUpload(
  pu: PendingUpload,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
): Promise<MediaAssetOut> {
  if (signal?.aborted) throw new DOMException('Загрузка отменена', 'AbortError')
  // Измерительный слой: засекаем каждый сетевой шаг, чтобы видеть, где на мобиле
  // теряется время (presign выдаёт бэкенд, PUT льёт в MinIO, confirm ждёт head_object
  // + генерацию превью). Сбор best-effort — не влияет на саму загрузку (см. metrics.ts).
  const tr = new MediaTracer('upload', pu.kind, pu.blob.size)
  const ticket = await tr.step('presign', () =>
    http.post<UploadTicket>('/api/media/uploads', {
      content_type: pu.contentType,
      size: pu.blob.size,
      kind: pu.kind,
    }),
  )
  // Прямой PUT клиент → MinIO (минуя бэкенд). ContentType PUT'а должен совпадать с
  // подписанным (иначе MinIO вернёт SignatureDoesNotMatch). Отмена рвёт этот шаг.
  await tr.step('put', () =>
    putWithProgress(ticket.upload_url, pu.blob, pu.contentType, onProgress, signal),
  )
  let thumbStorageKey: string | undefined
  if (pu.posterBlob) {
    thumbStorageKey =
      (await tr.step('poster', () => uploadPoster(pu.posterBlob as Blob))) ?? undefined
  }
  const asset = await tr.step('confirm', () =>
    http.post<MediaAssetOut>('/api/media/assets', {
      storage_key: ticket.storage_key,
      width: pu.width,
      height: pu.height,
      duration: pu.duration,
      thumb_storage_key: thumbStorageKey,
    }),
  )
  tr.done()
  return asset
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
