import { useRef, useState } from 'react'
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
  kind: MediaKind
  width: number | null
  height: number | null
  duration: number | null
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
        kind: attachment.kind,
        width: attachment.width,
        height: attachment.height,
        duration: attachment.duration,
      }
    : query.data
      ? {
          url: query.data.url,
          thumbUrl: query.data.thumb_url,
          kind: query.data.kind ?? guessMediaKind(query.data.url),
          width: query.data.width,
          height: query.data.height,
          duration: query.data.duration,
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
  const { url, thumbUrl, kind, width, height, duration } = resolved
  if (kind === 'audio') return <VoicePlayer src={url} duration={duration} />
  if (kind === 'image')
    return <ImageAttachment url={url} thumbUrl={thumbUrl} width={width} height={height} />
  if (kind === 'video')
    return <VideoPlayer src={url} width={width} height={height} poster={thumbUrl} />
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

/**
 * Картинка в ленте: нативный <img loading="lazy">, без blob-прогресса и крутилки.
 * В ленте грузим лёгкое превью (thumbUrl); оригинал (url) открывается только
 * в лайтбоксе по клику — так лента не тянет мегабайтные оригиналы. Коробка
 * резервируется по aspect-ratio из width/height (см. backfill_image_dims для
 * легаси-картинок); до декодирования виден только фон коробки, без индикатора.
 */
function ImageAttachment({
  url,
  thumbUrl,
  width,
  height,
}: {
  url: string
  thumbUrl: string | null
  width?: number | null
  height?: number | null
}) {
  const [open, setOpen] = useState(false)
  const feedUrl = thumbUrl ?? url // нет превью (видео старые/битые) — грузим оригинал
  const ratio = width && height ? width / height : undefined

  // Измерительный слой: сколько реально грузится картинка ленты на устройстве.
  // `loading="lazy"` → байты начинают тянуться, когда картинка подходит к вьюпорту,
  // поэтому засекаем не от монтирования, а от первого события загрузки (load start
  // недоступен для <img>, поэтому меряем от установки src-элемента до onLoad —
  // грубая, но сопоставимая по всем картинкам оценка «время до появления»).
  const startRef = useRef<number | null>(null)
  if (startRef.current === null) startRef.current = performance.now()
  const reported = useRef(false)
  const onImgLoad = () => {
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
    <div className={styles.attImageWrap} style={ratio ? { aspectRatio: String(ratio) } : undefined}>
      <img
        className={styles.attImage}
        src={feedUrl}
        alt=""
        loading="lazy"
        onClick={() => setOpen(true)}
        onLoad={onImgLoad}
      />
      {open && <Lightbox url={url} kind="image" onClose={() => setOpen(false)} />}
    </div>
  )
}
