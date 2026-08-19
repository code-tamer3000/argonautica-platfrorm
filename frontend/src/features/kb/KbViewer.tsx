import { useParams } from 'react-router-dom'
import { useKbItem } from '../../api/kb'
import { MdAttachment } from './MdAttachment'
import { KbComments } from './KbComments'
import { Spinner } from '../../components/Spinner'
import { Badge } from '../../components/Badge'
import { PageHeader } from '../../components/PageHeader'
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

  const bodyHtml = item.body
    ? DOMPurify.sanitize(marked.parse(item.body) as string)
    : ''

  return (
    <div className={styles.viewer}>
      <PageHeader title={item.title}>
        {user?.role === 'admin' && !item.published && (
          <Badge>Черновик</Badge>
        )}
      </PageHeader>
      <div className={styles.viewerHead}>
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
            <MdAttachment key={assetId} itemId={id} assetId={assetId} />
          ))}
        </div>
      )}

      <KbComments itemId={id} />
    </div>
  )
}
