import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDeleteKbItem, useKbItem, useUpdateKbItem } from '../../api/kb'
import { MdAttachment } from './MdAttachment'
import { KbComments } from './KbComments'
import { KbForm, type KbFormValues } from './KbForm'
import { Spinner } from '../../components/Spinner'
import { Badge } from '../../components/Badge'
import { PageHeader } from '../../components/PageHeader'
import { KebabMenu } from '../../components/KebabMenu'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Modal } from '../../components/Overlay'
import { useAuth } from '../auth/AuthContext'
import { toast } from '../../stores/toast'
import { dayLabel } from '../../lib/format'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import styles from './kb.module.css'

export function KbViewer() {
  const { itemId } = useParams<{ itemId: string }>()
  const id = Number(itemId ?? '0')
  const { data: item, isLoading } = useKbItem(id)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()

  const updateItem = useUpdateKbItem()
  const deleteItem = useDeleteKbItem()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  if (isLoading) return <div className="center grow"><Spinner /></div>
  if (!item) return <div className="center grow muted">Материал не найден</div>

  const bodyHtml = item.body
    ? DOMPurify.sanitize(marked.parse(item.body) as string)
    : ''

  function handleEdit(values: KbFormValues) {
    updateItem.mutate(
      {
        id: item!.id,
        title: values.title,
        body: values.body || null,
        published: values.published,
        category_id: values.category_id,
        intake_id: values.intake_id,
        plan_ids: values.plan_ids,
      },
      {
        onSuccess: () => {
          toast('Сохранено')
          setEditOpen(false)
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function togglePublished() {
    updateItem.mutate(
      { id: item!.id, published: !item!.published },
      {
        onSuccess: () => toast(item!.published ? 'Снято с публикации' : 'Опубликовано'),
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleDelete() {
    deleteItem.mutate(item!.id, {
      onSuccess: () => {
        toast('Удалено')
        navigate('/kb')
      },
      onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <div className={styles.viewer}>
      <PageHeader title={item.title}>
        {isAdmin && !item.published && <Badge>Черновик</Badge>}
        {isAdmin && (
          <KebabMenu
            ariaLabel="Действия с материалом"
            items={[
              { key: 'edit', label: 'Редактировать', onClick: () => setEditOpen(true) },
              {
                key: 'publish',
                label: item.published ? 'Снять с публикации' : 'Опубликовать',
                onClick: togglePublished,
              },
              { key: 'delete', label: 'Удалить', onClick: () => setDeleteOpen(true), danger: true },
            ]}
          />
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

      {editOpen && (
        <Modal title="Редактировать" onClose={() => setEditOpen(false)} closeOnBackdrop={false}>
          <KbForm initial={item} onSubmit={handleEdit} item={item} />
        </Modal>
      )}

      {deleteOpen && (
        <ConfirmDialog
          title="Удалить материал?"
          text="Материал и комментарии удалятся безвозвратно."
          onConfirm={handleDelete}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}
