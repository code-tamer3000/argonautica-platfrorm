import { useRef, useState } from 'react'
import {
  useKbItems,
  useCreateKbItem,
  useUpdateKbItem,
  useDeleteKbItem,
  useAttachKbMedia,
  useDetachKbMedia,
} from '../../api/kb'
import type { KbItemOut } from '../../lib/types'
import { mediaUpload } from '../../lib/mediaUpload'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { Attachment } from '../chat/Attachment'
import styles from './admin.module.css'

interface KbFormValues {
  title: string
  body: string
  published: boolean
}

interface KbFormProps {
  initial?: KbItemOut
  onSubmit: (values: KbFormValues) => void
  showMedia?: boolean
  item?: KbItemOut
}

function KbForm({ initial, onSubmit, showMedia, item }: KbFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [published, setPublished] = useState(initial?.published ?? false)

  const attachMedia = useAttachKbMedia()
  const detachMedia = useDetachKbMedia()
  const fileRef = useRef<HTMLInputElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({ title, body, published })
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !item) return
    try {
      const asset = await mediaUpload(file)
      attachMedia.mutate(
        { id: item.id, media_asset_ids: [asset.id] },
        {
          onSuccess: () => toast('Медиа прикреплено'),
          onError: (err: unknown) =>
            toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
        },
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки', 'error')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <label className={styles.label}>
        Заголовок
        <input
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Содержание
        <textarea
          className={styles.textarea}
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label className={styles.checkLabel}>
        <input
          type="checkbox"
          checked={published}
          onChange={(e) => setPublished(e.target.checked)}
        />
        Опубликовано
      </label>

      {showMedia && item && (
        <div className={styles.mediaSection}>
          <div className={styles.mediaSectionTitle}>Медиафайлы</div>
          {item.media_asset_ids.length === 0 && (
            <p className={styles.mediaEmpty}>Нет прикреплённых файлов</p>
          )}
          <div className={styles.mediaList}>
            {item.media_asset_ids.map((assetId) => (
              <div key={assetId} className={styles.mediaItem}>
                <Attachment assetId={assetId} />
                <Button
                  variant="outline"
                  type="button"
                  onClick={() =>
                    detachMedia.mutate(
                      { id: item.id, assetId },
                      {
                        onSuccess: () => toast('Откреплено'),
                        onError: (err: unknown) =>
                          toast(
                            err instanceof Error ? err.message : 'Ошибка',
                            'error',
                          ),
                      },
                    )
                  }
                >
                  Открепить
                </Button>
              </div>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Button
            variant="outline"
            type="button"
            onClick={() => fileRef.current?.click()}
          >
            Прикрепить медиа
          </Button>
        </div>
      )}

      <div className={styles.formActions}>
        <Button type="submit">Сохранить</Button>
      </div>
    </form>
  )
}

export function AdminKb() {
  const { data: items = [] } = useKbItems()
  const createItem = useCreateKbItem()
  const updateItem = useUpdateKbItem()
  const deleteItem = useDeleteKbItem()

  const [createOpen, setCreateOpen] = useState(false)
  const [editItem, setEditItem] = useState<KbItemOut | null>(null)

  function openEdit(item: KbItemOut) {
    setEditItem(item)
  }

  function handleCreate(values: KbFormValues) {
    createItem.mutate(
      { title: values.title, body: values.body || null, published: values.published },
      {
        onSuccess: () => {
          toast('Создано')
          setCreateOpen(false)
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleEdit(values: KbFormValues) {
    if (!editItem) return
    updateItem.mutate(
      {
        id: editItem.id,
        title: values.title,
        body: values.body || null,
        published: values.published,
      },
      {
        onSuccess: () => {
          toast('Сохранено')
          setEditItem(null)
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function togglePublished(item: KbItemOut) {
    updateItem.mutate(
      { id: item.id, published: !item.published },
      {
        onSuccess: () => toast(item.published ? 'Снято с публикации' : 'Опубликовано'),
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleDelete(id: number) {
    if (!window.confirm('Удалить?')) return
    deleteItem.mutate(id, {
      onSuccess: () => toast('Удалено'),
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>База знаний</h1>
        <Button onClick={() => setCreateOpen(true)}>Создать</Button>
      </div>

      <div className={styles.list}>
        {items.map((item) => (
          <div className={styles.listItem} key={item.id}>
            <div className={styles.listItemMain}>
              <span className={styles.listTitle}>{item.title}</span>
              {item.published ? (
                <span className={styles.badgePublished}>Опубликовано</span>
              ) : (
                <span className={styles.badgeDraft}>Черновик</span>
              )}
            </div>
            <div className={styles.listActions}>
              <Button variant="outline" onClick={() => openEdit(item)}>
                Редактировать
              </Button>
              <Button variant="outline" onClick={() => togglePublished(item)}>
                {item.published ? 'Снять' : 'Опубликовать'}
              </Button>
              <Button variant="outline" onClick={() => handleDelete(item.id)}>
                Удалить
              </Button>
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <Modal title="Создать материал" onClose={() => setCreateOpen(false)}>
          <KbForm onSubmit={handleCreate} />
        </Modal>
      )}

      {editItem && (
        <Modal title="Редактировать" onClose={() => setEditItem(null)}>
          <KbForm
            initial={editItem}
            onSubmit={handleEdit}
            showMedia
            item={editItem}
          />
        </Modal>
      )}
    </div>
  )
}
