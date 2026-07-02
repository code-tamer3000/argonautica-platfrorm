import { useState } from 'react'
import { useMediaUrl } from '../../api/media'
import { IconAttach } from '../../components/icons'
import { Lightbox } from '../../components/Overlay'
import { VideoPlayer } from '../../components/VideoPlayer'
import { VoicePlayer } from '../../components/VoicePlayer'
import { downloadFile, fileNameFromUrl, guessMediaKind } from '../../lib/mediaUpload'
import styles from './chat.module.css'

export function Attachment({ assetId }: { assetId: number }) {
  const { data } = useMediaUrl(assetId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!data) return <span className={styles.attLoading}>загрузка…</span>
  // Вид берём из media_assets (авторитетно), а не из расширения URL: webm/ogg
  // неоднозначны между audio и video. guessMediaKind — фолбэк для старых записей.
  const kind = data.kind ?? guessMediaKind(data.url)
  if (kind === 'audio') return <VoicePlayer src={data.url} duration={data.duration} />
  if (kind === 'image') {
    return (
      <>
        <img className={styles.attImage} src={data.url} alt="" loading="lazy" onClick={() => setOpen(true)} />
        {open && <Lightbox url={data.url} kind="image" onClose={() => setOpen(false)} />}
      </>
    )
  }
  if (kind === 'video') return <VideoPlayer src={data.url} />
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
