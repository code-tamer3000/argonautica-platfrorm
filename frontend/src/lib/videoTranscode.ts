// Клиентское сжатие видео ПЕРЕД заливкой в MinIO.
//
// Зачем: заливка видео — самый долгий шаг работы с медиа (метрики прода: 60 МБ →
// 153 с, упор в АПЛИНК мобильной сети ~3–6 Mbps). Сервер не горлышко. Единственный
// реальный рычаг — уменьшить число байт, которые уходят в PUT. Поэтому крупное видео
// перекодируем на клиенте в ≤720p с капнутым битрейтом: 60 МБ → ~10–15 МБ срезает
// заливку в 4–6 раз.
//
// Как (без внешних зависимостей, чтобы не тащить ffmpeg.wasm в PWA-бандл):
//   исходное <video> проигрываем в реальном времени → кадры рисуем на уменьшенный
//   <canvas> → canvas.captureStream() даёт видеодорожку → к ней подмешиваем
//   аудиодорожку исходника (video.captureStream) → MediaRecorder пишет их в webm/mp4
//   с ограниченным битрейтом. Перекодирование идёт со скоростью воспроизведения
//   (MediaRecorder работает в реальном времени) — это осознанный компромисс: тяжелее
//   ffmpeg.wasm по времени, но не грузит бандл и переживает слабые телефоны.
//
// iOS PWA Safari — основной мобильный доступ, поэтому ВСЁ под фичедетектом. Любая
// заминка (нет MediaRecorder/captureStream/поддерживаемого mime, кодек не играет в
// фоне, таймаут) → возвращаем null: вызывающий зальёт ОРИГИНАЛ, как раньше. Сжатие —
// улучшение, а не обязательный шаг; терять видео из-за него нельзя.

/** Результат успешного сжатия: перекодированный blob + его mime и размеры. */
export interface TranscodeResult {
  blob: Blob
  mimeType: string
  width: number
  height: number
}

// Ниже этого размера видео НЕ трогаем: мелкий клип уже лёгкий, а перекодирование
// съело бы CPU/время на телефоне без ощутимой выгоды для аплинка. Порог — в байтах.
export const VIDEO_COMPRESS_THRESHOLD_BYTES = 8 * 1024 * 1024 // ~8 МБ

// Целевой потолок бо́льшей стороны кадра. 720p — разумный предел для чата в PWA:
// заметно легче битрейтом, но всё ещё чёткое на телефоне. Меньшую сторону считаем
// пропорционально; если видео уже ≤ этого — не апскейлим.
const TARGET_MAX_DIMENSION = 1280 // 720p landscape → 1280×720

// Капнутый видеобитрейт (бит/с). ~2.5 Mbps на 720p — визуально приличный чат-клип и
// при этом в разы меньше исходников с телефона (часто 15–40 Mbps H.264/HEVC).
const TARGET_VIDEO_BITRATE = 2_500_000
const TARGET_AUDIO_BITRATE = 96_000

// Кандидаты контейнера/кодека под перекодирование, от предпочтительного к запасному.
// Safari (iOS) обычно умеет писать только mp4; Chrome/Firefox — webm (vp8/vp9). Берём
// первый, который реально поддерживает MediaRecorder на этом устройстве.
const MIME_CANDIDATES = [
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

/**
 * requestVideoFrameCallback (rVFC) даёт кадр строго при его отрисовке — точнее и
 * экономнее rAF для перекачки <video>→canvas. Есть в Safari 15.4+ и Chrome. Если нет
 * (старый WebView) — fallback на requestAnimationFrame: чуть менее точно по кадрам,
 * но перекодирование всё равно проходит.
 */
type FrameLoop = (draw: () => void) => { stop: () => void }

function frameLoopFor(video: HTMLVideoElement): FrameLoop {
  const hasRvfc = typeof (video as unknown as { requestVideoFrameCallback?: unknown })
    .requestVideoFrameCallback === 'function'
  if (hasRvfc) {
    return (draw) => {
      let handle = 0
      let stopped = false
      const v = video as HTMLVideoElement & {
        requestVideoFrameCallback: (cb: () => void) => number
        cancelVideoFrameCallback: (h: number) => void
      }
      const tick = () => {
        if (stopped) return
        draw()
        handle = v.requestVideoFrameCallback(tick)
      }
      handle = v.requestVideoFrameCallback(tick)
      return {
        stop: () => {
          stopped = true
          v.cancelVideoFrameCallback(handle)
        },
      }
    }
  }
  return (draw) => {
    let raf = 0
    let stopped = false
    const tick = () => {
      if (stopped) return
      draw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return {
      stop: () => {
        stopped = true
        cancelAnimationFrame(raf)
      },
    }
  }
}

/** Первый mime, который реально поддержан MediaRecorder на этом устройстве, или null. */
function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch {
      // isTypeSupported иногда бросает на кривых аргументах — пробуем следующий
    }
  }
  return null
}

/** Целевые размеры кадра: ужать бо́льшую сторону до TARGET_MAX_DIMENSION, не апскейлить.
 *  Приводим к чётным (некоторые энкодеры не любят нечётную ширину/высоту). */
function targetDims(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(1, TARGET_MAX_DIMENSION / Math.max(w, h))
  const width = Math.max(2, Math.round((w * scale) / 2) * 2)
  const height = Math.max(2, Math.round((h * scale) / 2) * 2)
  return { width, height }
}

/**
 * Поддерживает ли платформа наш путь сжатия в принципе (быстрый фичедетект без
 * запуска). Проверяем MediaRecorder + поддерживаемый mime + captureStream на canvas.
 * Не гарантирует успех (кодек может не проиграться в фоне), но отсекает заведомо
 * неспособные окружения без создания <video>.
 */
export function canTranscodeVideo(): boolean {
  if (typeof document === 'undefined') return false
  if (pickMime() === null) return false
  const canvas = document.createElement('canvas')
  return typeof (canvas as unknown as { captureStream?: unknown }).captureStream === 'function'
}

/** Прогресс перекодирования: доля 0..1. Дёргается по ходу проигрывания исходника. */
export type TranscodeProgress = (fraction: number) => void

/**
 * Перекодировать видеофайл в ≤720p с капнутым битрейтом, сохранив аудиодорожку.
 * Возвращает сжатый blob или null, если сжать не удалось (тогда вызывающий льёт
 * оригинал). НИКОГДА не бросает — любая ошибка сворачивается в null.
 *
 * `signal` — необязательная отмена (напр. юзер убрал вложение); при abort резолвится null.
 * `onProgress` — доля 0..1 по ходу перекодирования (оно идёт со скоростью
 * воспроизведения, поэтому `currentTime/duration` — честный прогресс, а не спиннер).
 */
export async function transcodeVideo(
  file: File,
  signal?: AbortSignal,
  onProgress?: TranscodeProgress,
): Promise<TranscodeResult | null> {
  const mimeType = pickMime()
  if (mimeType === null || !canTranscodeVideo()) return null

  return new Promise<TranscodeResult | null>((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false
    let loop: { stop: () => void } | null = null
    let recorder: MediaRecorder | null = null
    let canvasStream: MediaStream | null = null
    let srcStream: MediaStream | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      loop?.stop()
      try {
        recorder?.state !== 'inactive' && recorder?.stop()
      } catch {
        /* recorder уже остановлен */
      }
      canvasStream?.getTracks().forEach((t) => t.stop())
      srcStream?.getTracks().forEach((t) => t.stop())
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
    const fail = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(null)
    }
    const succeed = (result: TranscodeResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    if (signal) {
      if (signal.aborted) return fail()
      signal.addEventListener('abort', fail, { once: true })
    }

    // Общий предохранитель: перекодирование идёт в реальном времени, но не ждём
    // дольше 3× длительности (плюс базовый запас) — если что-то залипло, откатимся
    // на заливку оригинала, а не подвесим отправку.
    const armTimeout = (durationSec: number) => {
      const ms = Math.max(30_000, Math.round(durationSec * 3 * 1000) + 15_000)
      timeout = setTimeout(fail, ms)
    }

    video.muted = true // без звука в фоне (сам звук всё равно берём из captureStream)
    video.playsInline = true
    video.preload = 'auto'
    video.src = url

    video.onloadedmetadata = () => {
      const sw = video.videoWidth
      const sh = video.videoHeight
      if (!sw || !sh) return fail()
      const { width, height } = targetDims(sw, sh)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return fail()

      // Видеодорожка из canvas + аудиодорожка из исходника (если она есть). На iOS
      // video.captureStream может отсутствовать — тогда пишем без звука (лучше немое
      // сжатое видео, чем провал сжатия). Аудио берём ДО play(), треки живут в потоке.
      const cs = canvas as unknown as { captureStream: (fps?: number) => MediaStream }
      canvasStream = cs.captureStream(30)
      const combined = new MediaStream(canvasStream.getVideoTracks())
      const vcap = (video as unknown as { captureStream?: () => MediaStream }).captureStream
      if (typeof vcap === 'function') {
        try {
          srcStream = vcap.call(video)
          for (const track of srcStream.getAudioTracks()) combined.addTrack(track)
        } catch {
          // без аудиодорожки — не критично, продолжаем с немым видео
        }
      }

      try {
        recorder = new MediaRecorder(combined, {
          mimeType,
          videoBitsPerSecond: TARGET_VIDEO_BITRATE,
          audioBitsPerSecond: TARGET_AUDIO_BITRATE,
        })
      } catch {
        return fail()
      }

      const chunks: BlobPart[] = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data)
      }
      recorder.onerror = fail
      recorder.onstop = () => {
        if (settled) return
        const blob = new Blob(chunks, { type: mimeType })
        // Защита от бессмысленного сжатия: если «сжатый» файл не меньше исходного
        // (короткий клип, уже сильно пожатый источник) — откатываемся на оригинал.
        if (blob.size === 0 || blob.size >= file.size) return fail()
        succeed({ blob, mimeType, width, height })
      }

      // Рисуем каждый выданный кадр исходника на уменьшенный canvas и заодно
      // отдаём прогресс: перекодирование идёт со скоростью воспроизведения, поэтому
      // currentTime/duration — честная доля. Клампим в 0..0.99, чтобы 100% отдать
      // только по факту готового blob (onended → succeed), а не на последнем кадре.
      const total = video.duration || 0
      loop = frameLoopFor(video)(() => {
        ctx.drawImage(video, 0, 0, width, height)
        if (onProgress && total > 0) {
          onProgress(Math.min(0.99, video.currentTime / total))
        }
      })

      // Конец воспроизведения → останавливаем запись (onstop соберёт blob).
      video.onended = () => {
        loop?.stop()
        onProgress?.(1)
        try {
          if (recorder && recorder.state !== 'inactive') recorder.stop()
        } catch {
          fail()
        }
      }
      video.onerror = fail

      armTimeout(video.duration || 0)
      try {
        recorder.start()
      } catch {
        return fail()
      }
      // play() возвращает промис — при отклонении (автоплей заблокирован и т.п.) откат.
      const p = video.play()
      if (p && typeof p.catch === 'function') p.catch(fail)
    }
    video.onerror = fail
  })
}
