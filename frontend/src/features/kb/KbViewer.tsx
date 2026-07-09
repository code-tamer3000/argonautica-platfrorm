import { Navigate, useParams } from 'react-router-dom'
import { useKbItem } from '../../api/kb'
import { Attachment } from '../chat/Attachment'
import { KbComments } from './KbComments'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../auth/AuthContext'
import { dayLabel } from '../../lib/format'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import styles from './kb.module.css'

export function KbViewer() {
  const { itemId } = useParams<{ itemId: string }>()
  const id = Number(itemId ?? '0')
  const { data: item, isLoading } = useKbItem(id)
  const { user } = useAuth()

  if (isLoading) return <div className="center grow"><Spinner /></div>
  if (!item) return <div className="center grow muted">Материал не найден</div>
  // Books render in the dedicated reader (chapters + TOC), not the flat viewer.
  if (item.kind === 'book') return <Navigate to={`/kb/book/${item.id}`} replace />

  const bodyHtml = item.body
    ? DOMPurify.sanitize(marked.parse(item.body) as string)
    : ''

  return (
    <div className={styles.viewer}>
      <div className={styles.viewerHead}>
        {user?.role === 'admin' && !item.published && (
          <span className={styles.badgeDraft}>Черновик</span>
        )}
        <h1 className={styles.articleTitle}>{item.title}</h1>
        <div className={styles.articleMeta}>
          Обновлено: {dayLabel(item.updated_at)}
        </div>
      </div>
      {bodyHtml && (
        <div
          className={styles.articleBody}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      )}
      {item.media_asset_ids.length > 0 && (
        <div className={styles.kbMedia}>
          {item.media_asset_ids.map((assetId) => (
            <Attachment key={assetId} assetId={assetId} />
          ))}
        </div>
      )}

      <KbComments itemId={id} />
    </div>
  )
}
