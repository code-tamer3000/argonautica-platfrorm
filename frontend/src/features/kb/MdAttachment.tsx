import { Link } from 'react-router-dom'
import { useMediaUrl } from '../../api/media'
import { fileNameFromUrl } from '../../lib/mediaUpload'
import { Attachment } from '../chat/Attachment'
import styles from './kb.module.css'

/** True when a resolved presigned URL points at a markdown file. */
export function isMarkdownUrl(url: string | undefined): boolean {
  if (!url) return false
  return /\.(md|markdown)$/i.test(fileNameFromUrl(url))
}

/**
 * An attached file inside a KB article. Plain files render as the usual
 * download `Attachment`; a `.md` file additionally gets a «Читать» button that
 * opens the chapter reader (`/kb/read/:itemId/:assetId`). We resolve the asset
 * URL to sniff the extension — `.md` files carry no distinct media kind.
 */
export function MdAttachment({ itemId, assetId }: { itemId: number; assetId: number }) {
  const { data: media } = useMediaUrl(assetId)
  const isMd = isMarkdownUrl(media?.url)

  if (!isMd) return <Attachment assetId={assetId} />

  return (
    <div className={styles.mdAttachment}>
      <Attachment assetId={assetId} />
      <Link to={`/kb/read/${itemId}/${assetId}`} className={styles.readButton}>
        📖 Читать
      </Link>
    </div>
  )
}
