import { useState } from 'react'
import { useMediaUrl } from '../../api/media'
import { IconAttach } from '../../components/icons'
import { Lightbox } from '../../components/Overlay'
import { ProgressRing } from '../../components/ProgressRing'
import { Spinner } from '../../components/Spinner'
import { VideoPlayer } from '../../components/VideoPlayer'
import { VoicePlayer } from '../../components/VoicePlayer'
import { downloadFile, fileNameFromUrl, guessMediaKind } from '../../lib/mediaUpload'
import { useMediaProgress } from '../../lib/useMediaProgress'
import styles from './chat.module.css'

export function Attachment({ assetId }: { assetId: number }) {
  const { data } = useMediaUrl(assetId)
  const [busy, setBusy] = useState(false)
  // Пока presigned-URL ещё запрашивается у бэкенда — крутилка (файл уже на сервере).
  if (!data)
    return (
      <span className={styles.attLoading}>
        <Spinner size={16} /> загрузка…
      </span>
    )
  // Вид берём из media_assets (авторитетно), а не из расширения URL: webm/ogg
  // неоднозначны между audio и video. guessMediaKind — фолбэк для старых записей.
  const kind = data.kind ?? guessMediaKind(data.url)
  if (kind === 'audio') return <VoicePlayer src={data.url} duration={data.duration} />
  if (kind === 'image')
    return <ImageAttachment url={data.url} width={data.width} height={data.height} />
  if (kind === 'video') return <VideoPlayer src={data.url} width={data.width} height={data.height} />
  // Скачиваем через blob (см. downloadFile) — надёжно на мобиле и в iOS-PWA, где
  // кросс-доменный `download`/`target=_blank` не срабатывают.
  const name = fileNameFromUrl(data.url)
  async function handleDownload() {
    if (busy || !data) return
    setBusy(true)
    try {
      await downloadFile(data.url, name)
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
 * Картинка с индикатором загрузки байтов. Тянем файл через fetch с прогрессом (см.
 * useMediaProgress) и показываем круговой % поверх зарезервированной по aspect-ratio
 * коробки, пока грузится. Если fetch недоступен (CORS) — откат на прямой <img src> с
 * крутилкой без процента. Клик по готовой картинке открывает лайтбокс.
 */
function ImageAttachment({
  url,
  width,
  height,
}: {
  url: string
  width?: number | null
  height?: number | null
}) {
  const [open, setOpen] = useState(false)
  const [directLoaded, setDirectLoaded] = useState(false)
  const { objectUrl, progress, failed } = useMediaProgress(url)
  const src = objectUrl ?? (failed ? url : undefined)
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
