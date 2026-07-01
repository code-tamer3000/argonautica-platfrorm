import { useState } from 'react'
import { useMediaUrl } from '../../api/media'
import { IconAttach } from '../../components/icons'
import { Lightbox } from '../../components/Overlay'
import { guessMediaKind } from '../../lib/mediaUpload'
import styles from './chat.module.css'

export function Attachment({ assetId }: { assetId: number }) {
  const { data } = useMediaUrl(assetId)
  const [open, setOpen] = useState(false)
  if (!data) return <span className={styles.attLoading}>загрузка…</span>
  const kind = guessMediaKind(data.url)
  if (kind === 'image') {
    return (
      <>
        <img className={styles.attImage} src={data.url} alt="" loading="lazy" onClick={() => setOpen(true)} />
        {open && <Lightbox url={data.url} kind="image" onClose={() => setOpen(false)} />}
      </>
    )
  }
  if (kind === 'video') return <video className={styles.attVideo} src={data.url} controls />
  return (
    <a className={styles.attFile} href={data.url} download rel="noreferrer">
      <IconAttach size={16} /> Скачать файл
    </a>
  )
}
