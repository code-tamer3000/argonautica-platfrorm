import { useState } from 'react'
import { useMediaUrl } from '../../api/media'
import { IconAttach } from '../../components/icons'
import { Lightbox } from '../../components/Overlay'
import { ProgressRing } from '../../components/ProgressRing'
import { Spinner } from '../../components/Spinner'
import { VideoPlayer } from '../../components/VideoPlayer'
import { VoicePlayer } from '../../components/VoicePlayer'
import { downloadFile, fileNameFromUrl, guessMediaKind } from '../../lib/mediaUpload'
import type { AttachmentOut, MediaKind } from '../../lib/types'
import { useMediaProgress } from '../../lib/useMediaProgress'
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
 * Картинка с индикатором загрузки байтов. В ленте грузим лёгкое превью (thumbUrl);
 * оригинал (url) открывается только в лайтбоксе по клику — так лента не тянет
 * мегабайтные оригиналы. Тянем файл через fetch с прогрессом (см. useMediaProgress)
 * и показываем круговой % поверх зарезервированной по aspect-ratio коробки. Если fetch
 * недоступен (CORS) — откат на прямой <img src> с крутилкой без процента.
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
  const [directLoaded, setDirectLoaded] = useState(false)
  const feedUrl = thumbUrl ?? url // нет превью (видео старые/битые) — грузим оригинал
  const { objectUrl, progress, failed } = useMediaProgress(feedUrl)
  const src = objectUrl ?? (failed ? feedUrl : undefined)
  const loaded = objectUrl != null || (failed && directLoaded)
  const ratio = width && height ? width / height : undefined

  return (
    <div
      className={`${styles.attImageWrap} ${loaded ? '' : styles.attImageLoading}`}
      style={ratio ? { aspectRatio: String(ratio) } : undefined}
    >
      {src && (
        <img
          className={styles.attImage}
          src={src}
          alt=""
          loading="lazy"
          onClick={() => loaded && setOpen(true)}
          onLoad={() => failed && setDirectLoaded(true)}
        />
      )}
      {!loaded && <ProgressRing progress={failed ? null : progress} />}
      {open && <Lightbox url={url} kind="image" onClose={() => setOpen(false)} />}
    </div>
  )
}
