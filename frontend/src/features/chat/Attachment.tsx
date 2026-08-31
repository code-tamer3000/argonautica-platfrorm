import { type SyntheticEvent, useRef, useState } from 'react'
import { useMediaUrl } from '../../api/media'
import { IconAttach } from '../../components/icons'
import { Lightbox } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { VideoPlayer } from '../../components/VideoPlayer'
import { VoicePlayer } from '../../components/VoicePlayer'
import { downloadFile, fileNameFromUrl, guessMediaKind } from '../../lib/mediaUpload'
import { reportMetric } from '../../lib/metrics'
import type { AttachmentOut, MediaKind } from '../../lib/types'
import styles from './chat.module.css'

/** Уже разрешённое вложение: адреса и метаданные готовы, лишний запрос не нужен. */
type Resolved = {
  url: string
  thumbUrl: string | null
  // Средний дериват картинки для лайтбокса; null/undefined — открываем оригинал.
  previewUrl?: string | null
  kind: MediaKind
  width: number | null
  height: number | null
  duration: number | null
  // Состояние серверного транскода видео (у не-видео/легаси — undefined/null).
  transcodeStatus?: 'processing' | 'done' | 'failed' | null
}

/**
 * Вложение сообщения. Два входа:
 *  - `attachment` — данные уже пришли в ленте (presigned-URL + превью): рендерим сразу,
 *    без per-asset round-trip. Основной путь для чата/новостей.
 *  - `assetId` — есть только id (база знаний): тянем presigned-URL по id (фолбэк).
 */
export function Attachment({
  attachment,
  assetId,
}: {
  attachment?: AttachmentOut
  assetId?: number
}) {
  // Хук вызывается всегда (правила hooks), но простаивает, если данные уже есть.
  const query = useMediaUrl(attachment ? null : assetId ?? null)
  const resolved: Resolved | null = attachment
    ? {
        url: attachment.url,
        thumbUrl: attachment.thumb_url,
        previewUrl: attachment.preview_url,
        kind: attachment.kind,
        width: attachment.width,
        height: attachment.height,
        duration: attachment.duration,
        transcodeStatus: attachment.transcode_status,
      }
    : query.data
      ? {
          url: query.data.url,
          thumbUrl: query.data.thumb_url,
          previewUrl: query.data.preview_url,
          kind: query.data.kind ?? guessMediaKind(query.data.url),
          width: query.data.width,
          height: query.data.height,
          duration: query.data.duration,
          transcodeStatus: query.data.transcode_status,
        }
      : null

  const [busy, setBusy] = useState(false)
  // Пока presigned-URL ещё запрашивается у бэкенда — крутилка (файл уже на сервере).
  if (!resolved)
    return (
      <span className={styles.attLoading}>
        <Spinner size={16} /> загрузка…
      </span>
    )
  const { url, thumbUrl, previewUrl, kind, width, height, duration, transcodeStatus } = resolved
  if (kind === 'audio') return <VoicePlayer src={url} duration={duration} />
  if (kind === 'image')
    return (
      <ImageAttachment
        url={url}
        thumbUrl={thumbUrl}
        previewUrl={previewUrl}
        width={width}
        height={height}
      />
    )
  if (kind === 'video') {
    // Серверный транскод (docs/FILES.md). 'processing' — вариант ещё готовится: постер
    // + спиннер, играть пока нельзя. 'failed' — вариант не собрался: даём скачать
    // оригинал (url ведёт на него) + подсказку. 'done'/null(легаси) — играем как обычно.
    if (transcodeStatus === 'processing')
      return <VideoProcessing thumbUrl={thumbUrl} width={width} height={height} />
    if (transcodeStatus === 'failed')
      return <VideoFailed url={url} />
    return <VideoPlayer src={url} width={width} height={height} poster={thumbUrl} />
  }
  // Скачиваем через blob (см. downloadFile) — надёжно на мобиле и в iOS-PWA, где
  // кросс-доменный `download`/`target=_blank` не срабатывают.
  const name = fileNameFromUrl(url)
  async function handleDownload() {
    if (busy) return
    setBusy(true)
    try {
      await downloadFile(url, name)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className={styles.attFile} onClick={handleDownload} disabled={busy}>
      <IconAttach size={16} /> {busy ? 'Скачивание…' : `Скачать ${name}`}
    </button>
  )
}

/** Потолок коробки картинки в ленте (px). Больше не растягиваем — это лента, не просмотр. */
const FEED_MAX_W = 280
const FEED_MAX_H = 360

/**
 * Ширина коробки под картинку с известными пропорциями: вписываем в FEED_MAX_W×FEED_MAX_H,
 * маленькие картинки не растягиваем (scale ≤ 1). Высоту задавать не нужно — её даст сама
 * картинка по своим пропорциям, а на узком экране коробка сожмётся по max-width: 100%.
 */
function feedBoxWidth(w: number, h: number): number {
  const scale = Math.min(FEED_MAX_W / w, FEED_MAX_H / h, 1)
  return Math.round(w * scale)
}

/**
 * Картинка в ленте: нативный <img>, без blob-прогресса и крутилки.
 * В ленте грузим лёгкое превью (thumbUrl); по клику лайтбокс открывает средний
 * дериват (previewUrl, ~1600px WebP) и лишь при его отсутствии — оригинал (url),
 * так что мегабайтные оригиналы не тянутся ни в ленте, ни при просмотре.
 *
 * РАЗМЕР КОРОБКИ СЧИТАЕМ САМИ (feedBoxWidth) и ставим ШИРИНОЙ в px, а высоту отдаём
 * нативным width/height у <img> (height: auto в CSS). Это принципиально: раньше
 * коробка полагалась на inline aspect-ratio, а картинка внутри — на height: 100%,
 * то есть ширина коробки зависела от ещё не загруженной картинки, а высота картинки —
 * от высоты коробки. В WebKit (iOS Safari и установленное PWA) этот круг схлопывал
 * коробку в тонкую полоску и НЕ пересчитывался после прихода байтов: фото не
 * появлялось, сколько ни жди, хотя nginx отдавал превью 200-м и целиком (проверено
 * по логам шлюза). Повторный заход в комнату «чинил» показ только потому, что во
 * второй раз размеры картинки уже известны браузеру из его кэша в первом же проходе
 * раскладки. Теперь коробка знает свой размер до первого байта и ни от чего не зависит.
 * Для легаси-строк без width/height коробка-плейсхолдер (attImagePending) держит место,
 * пока картинка не декодируется, а по onLoad берём naturalWidth/naturalHeight.
 *
 * БЕЗ loading="lazy": в мобильном WebKit/Chrome-standalone (установленное PWA)
 * нативный lazy-load ненадёжен именно внутри вложенного скролл-контейнера
 * (`.messages { overflow-y: auto }`, не скролл всей страницы) — картинка может
 * не начать грузиться НИКОГДА, запрос в сеть просто не уходит. На десктопе
 * тот же код работает исправно, поэтому баг долго не замечали. Стикеры
 * (MessageItem.tsx) тем же способом грузятся без lazy и без этой проблемы —
 * ленту решили не оптимизировать этим механизмом ради надёжности на мобиле.
 */
function ImageAttachment({
  url,
  thumbUrl,
  previewUrl,
  width,
  height,
}: {
  url: string
  thumbUrl: string | null
  previewUrl?: string | null
  width?: number | null
  height?: number | null
}) {
  const [open, setOpen] = useState(false)
  const feedUrl = thumbUrl ?? url // нет превью (видео старые/битые) — грузим оригинал
  // Фолбэк на оригинал обязателен: у легаси-вложений и при неудавшейся генерации
  // preview_url = null, и просмотр должен работать как раньше.
  const lightboxUrl = previewUrl ?? url
  // Пропорции: из метаданных вложения, а у легаси-строк без них — из самой картинки,
  // как только она декодировалась (до этого стоит коробка-плейсхолдер).
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const dims = width && height ? { w: width, h: height } : natural
  const boxWidth = dims ? feedBoxWidth(dims.w, dims.h) : undefined

  // Измерительный слой: сколько реально грузится картинка ленты на устройстве.
  // Засекаем не от монтирования, а от первого события загрузки (load start
  // недоступен для <img>, поэтому меряем от установки src-элемента до onLoad —
  // грубая, но сопоставимая по всем картинкам оценка «время до появления»).
  const startRef = useRef<number | null>(null)
  if (startRef.current === null) startRef.current = performance.now()
  const reported = useRef(false)
  const onImgLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    // Легаси без размеров в базе: узнаём их у самой картинки и фиксируем коробку —
    // дальше её ширина так же не зависит от загрузки (важно при перерисовках ленты).
    if (!dims) {
      const img = e.currentTarget
      if (img.naturalWidth > 0 && img.naturalHeight > 0)
        setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    }
    if (reported.current || startRef.current === null) return
    reported.current = true
    reportMetric({
      op: 'download',
      kind: 'image',
      // Превью грузим в ленте — по нему и меряем «долго грузит фото».
      total_ms: performance.now() - startRef.current,
      steps: { load_ms: performance.now() - startRef.current },
    })
  }

  return (
    <div
      className={boxWidth ? styles.attImageWrap : `${styles.attImageWrap} ${styles.attImagePending}`}
      style={boxWidth ? { width: boxWidth } : undefined}
    >
      <img
        className={styles.attImage}
        src={feedUrl}
        alt=""
        // Нативные width/height задают пропорции ещё до первого байта: браузер сам
        // считает высоту при height: auto. Вместе с заданной шириной коробки это и
        // есть резерв места, не зависящий от того, загрузилась картинка или нет.
        width={dims?.w}
        height={dims?.h}
        onClick={() => setOpen(true)}
        onLoad={onImgLoad}
      />
      {open && <Lightbox url={lightboxUrl} kind="image" onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * Видео в состоянии транскода (`processing`): показываем клиентский постер (если сняли
 * при загрузке) + спиннер-оверлей «Обработка видео…». Играть ещё нельзя — вариант готовит
 * сервер; по готовности прилетит WS `attachment.updated` и вложение сменится на плеер.
 * Коробку резервируем по aspect-ratio, чтобы не было скачка при появлении плеера.
 */
function VideoProcessing({
  thumbUrl,
  width,
  height,
}: {
  thumbUrl: string | null
  width: number | null
  height: number | null
}) {
  const ratio = width && height ? width / height : undefined
  return (
    <div
      className={styles.attVideoProcessing}
      style={ratio ? { aspectRatio: String(ratio) } : undefined}
    >
      {thumbUrl && <img className={styles.attVideoPoster} src={thumbUrl} alt="" />}
      <div className={styles.attVideoOverlay}>
        <Spinner size={20} />
        <span>Обработка видео…</span>
      </div>
    </div>
  )
}

/**
 * Видео, у которого транскод провалился (`failed`): вариант не собрался, но ОРИГИНАЛ
 * цел (url ведёт на него). Даём скачать его файлом + подсказку — воспроизведение в
 * ленте не гарантируем (формат мог быть неигрибельным в браузере, потому и транскодили).
 */
function VideoFailed({ url }: { url: string }) {
  const [busy, setBusy] = useState(false)
  const name = fileNameFromUrl(url)
  async function handleDownload() {
    if (busy) return
    setBusy(true)
    try {
      await downloadFile(url, name)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.attVideoFailed}>
      <button className={styles.attFile} onClick={handleDownload} disabled={busy}>
        <IconAttach size={16} /> {busy ? 'Скачивание…' : `Скачать ${name}`}
      </button>
      {/* Оригинал цел и качается — говорим это прямо, иначе «не удалась» читается
          как «файл потерян». Причину отказа знает только лог воркера. */}
      <span className={styles.attVideoFailedHint}>
        Видео не удалось подготовить к просмотру — оригинал можно скачать
      </span>
    </div>
  )
}
