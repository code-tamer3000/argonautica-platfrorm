import { Link } from 'react-router-dom'
import { useMediaUrl } from '../../api/media'
import { fileNameFromUrl } from '../../lib/mediaUpload'
import { IconBook } from '../../components/icons'
import { Attachment } from '../chat/Attachment'
import styles from './kb.module.css'

/** True when a resolved presigned URL points at a markdown file. */
export function isMarkdownUrl(url: string | undefined): boolean {
  if (!url) return false
  return /\.(md|markdown)$/i.test(fileNameFromUrl(url))
}

/**
 * An attached file inside a KB article. A `.md` file is a book — it renders as a
 * single «Читать» button opening the chapter reader (`/kb/read/:itemId/:assetId`),
 * with no download link. Any other file (PDF, etc.) renders as the usual download
 * `Attachment`. We resolve the asset URL to sniff the extension — `.md` files
 * carry no distinct media kind.
 */
export function MdAttachment({ itemId, assetId }: { itemId: number; assetId: number }) {
  const { data: media } = useMediaUrl(assetId)
  const isMd = isMarkdownUrl(media?.url)

  if (!isMd) return <Attachment assetId={assetId} />

  return (
    <Link to={`/kb/read/${itemId}/${assetId}`} className={styles.readButton}>
      <IconBook size={16} /> Читать
    </Link>
  )
}
