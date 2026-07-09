import { useRef, useState } from 'react'
import {
  useKbItems,
  useKbItem,
  useCreateKbItem,
  useUpdateKbItem,
  useDeleteKbItem,
  useAttachKbMedia,
  useDetachKbMedia,
} from '../../api/kb'
import type { KbItemOut, KbKind } from '../../lib/types'
import { mediaUpload } from '../../lib/mediaUpload'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { Attachment } from '../chat/Attachment'
import styles from './admin.module.css'

interface KbFormValues {
  title: string
  body: string
  kind: KbKind
  published: boolean
  media_asset_ids: number[]
}

interface KbFormProps {
  initial?: KbItemOut
  onSubmit: (values: KbFormValues) => void
  /** Существующий материал: медиа прикрепляем/открепляем сразу через API.
      Без него (создание) — складываем id загруженных файлов и отдаём в onSubmit. */
  item?: KbItemOut
}

function KbForm({ initial, onSubmit, item }: KbFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [kind, setKind] = useState<KbKind>(initial?.kind ?? 'article')
  const [published, setPublished] = useState(initial?.published ?? false)
  // Локально загруженные медиа для режима СОЗДАНИЯ (когда item ещё нет).
  const [stagedMedia, setStagedMedia] = useState<number[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)

  const attachMedia = useAttachKbMedia()
  const detachMedia = useDetachKbMedia()
  const fileRef = useRef<HTMLInputElement>(null)

  // Подписываемся на живые данные из кэша — обновятся после attach/detach.
  const { data: liveItem } = useKbItem(item?.id ?? 0)
  // Прикреплённые медиа: у существующего материала — живые из кэша, у нового — staged.
  const mediaIds = item ? (liveItem?.media_asset_ids ?? item.media_asset_ids) : stagedMedia

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({ title, body, kind, published, media_asset_ids: stagedMedia })
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setProgress(0)
    try {
      const asset = await mediaUpload(file, (f) => setProgress(Math.round(f * 100)))
      if (item) {
        // Редактирование: линкуем к материалу сразу.
        attachMedia.mutate(
          { id: item.id, media_asset_ids: [asset.id] },
          {
            onSuccess: () => toast('Медиа прикреплено'),
            onError: (err: unknown) =>
              toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
          },
        )
      } else {
        // Создание: копим id, прилинкуем при сохранении материала.
        setStagedMedia((prev) => [...prev, asset.id])
        toast('Медиа добавлено')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки', 'error')
    } finally {
      setUploading(false)
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function removeMedia(assetId: number) {
    if (item) {
      detachMedia.mutate(
        { id: item.id, assetId },
        {
          onSuccess: () => toast('Откреплено'),
          onError: (err: unknown) =>
            toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
        },
      )
    } else {
      setStagedMedia((prev) => prev.filter((id) => id !== assetId))
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
        Тип материала
        <select
          className={styles.input}
          value={kind}
          onChange={(e) => setKind(e.target.value as KbKind)}
        >
          <option value="article">Статья</option>
          <option value="book">Книга (читалка)</option>
        </select>
      </label>
      <label className={styles.label}>
        Содержание{kind === 'book' ? ' (markdown; «## Заголовок» = новая глава)' : ''}
        <textarea
          className={styles.textarea}
          rows={kind === 'book' ? 14 : 8}
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

      <div className={styles.mediaSection}>
        <div className={styles.mediaSectionTitle}>Медиафайлы</div>
        {mediaIds.length === 0 && (
          <p className={styles.mediaEmpty}>Нет прикреплённых файлов</p>
        )}
        <div className={styles.mediaList}>
          {mediaIds.map((assetId) => (
            <div key={assetId} className={styles.mediaItem}>
              <Attachment assetId={assetId} />
              <Button variant="outline" type="button" onClick={() => removeMedia(assetId)}>
                {item ? 'Открепить' : 'Убрать'}
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
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Загрузка…' : 'Прикрепить медиа'}
        </Button>
        {progress !== null && (
          <div className={styles.uploadProgress}>
            <div className={styles.uploadBar}>
              <div className={styles.uploadBarFill} style={{ width: `${progress}%` }} />
            </div>
            <span className={styles.uploadPct}>{progress}%</span>
          </div>
        )}
      </div>

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
      {
        title: values.title,
        body: values.body || null,
        kind: values.kind,
        published: values.published,
        media_asset_ids: values.media_asset_ids,
      },
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
        kind: values.kind,
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
          <KbForm initial={editItem} onSubmit={handleEdit} item={editItem} />
        </Modal>
      )}
    </div>
  )
}
