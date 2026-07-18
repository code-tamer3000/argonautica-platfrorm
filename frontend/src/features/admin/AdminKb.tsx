import { useRef, useState } from 'react'
import {
  useKbItems,
  useKbItem,
  useKbCategories,
  useCreateKbItem,
  useUpdateKbItem,
  useDeleteKbItem,
  useCreateKbCategory,
  useUpdateKbCategory,
  useDeleteKbCategory,
  useAttachKbMedia,
  useDetachKbMedia,
} from '../../api/kb'
import type { KbItemOut } from '../../lib/types'
import { mediaUpload, isUploadAbort } from '../../lib/mediaUpload'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { Attachment } from '../chat/Attachment'
import styles from './admin.module.css'

interface KbFormValues {
  title: string
  body: string
  published: boolean
  category_id: number | null
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
  const [published, setPublished] = useState(initial?.published ?? false)
  const [categoryId, setCategoryId] = useState<number | null>(initial?.category_id ?? null)
  const { data: categories = [] } = useKbCategories()
  // Локально загруженные медиа для режима СОЗДАНИЯ (когда item ещё нет).
  const [stagedMedia, setStagedMedia] = useState<number[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  // Отмена текущей загрузки + подтверждающий поп-ап над ней.
  const uploadAbort = useRef<AbortController | null>(null)
  const [cancelAsk, setCancelAsk] = useState(false)

  const attachMedia = useAttachKbMedia()
  const detachMedia = useDetachKbMedia()
  const fileRef = useRef<HTMLInputElement>(null)

  // Подписываемся на живые данные из кэша — обновятся после attach/detach.
  const { data: liveItem } = useKbItem(item?.id ?? 0)
  // Прикреплённые медиа: у существующего материала — живые из кэша, у нового — staged.
  const mediaIds = item ? (liveItem?.media_asset_ids ?? item.media_asset_ids) : stagedMedia

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({ title, body, published, category_id: categoryId, media_asset_ids: stagedMedia })
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const controller = new AbortController()
    uploadAbort.current = controller
    setUploading(true)
    setProgress(0)
    try {
      const { asset } = await mediaUpload(
        file,
        (f) => setProgress(Math.round(f * 100)),
        controller.signal,
      )
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
      // Отмена — не ошибка: тост не показываем.
      if (!isUploadAbort(err)) {
        toast(err instanceof Error ? err.message : 'Ошибка загрузки', 'error')
      }
    } finally {
      uploadAbort.current = null
      setUploading(false)
      setProgress(null)
      setCancelAsk(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function confirmCancelUpload() {
    uploadAbort.current?.abort()
    setCancelAsk(false)
    toast('Загрузка отменена')
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
        Содержание
        <textarea
          className={styles.textarea}
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label className={styles.label}>
        Категория
        <select
          className={styles.input}
          value={categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Без категории</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.title}
            </option>
          ))}
        </select>
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
            <button
              type="button"
              className={styles.uploadCancel}
              onClick={() => setCancelAsk(true)}
              aria-label="Отменить загрузку"
              title="Отменить загрузку"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {cancelAsk && (
        <Modal title="Отменить загрузку?" onClose={() => setCancelAsk(false)}>
          <p className={styles.confirmText}>
            Загрузка файла будет прервана. Продолжить?
          </p>
          <div className={styles.formActions}>
            <Button variant="outline" type="button" onClick={() => setCancelAsk(false)}>
              Продолжить загрузку
            </Button>
            <Button type="button" onClick={confirmCancelUpload}>
              Отменить загрузку
            </Button>
          </div>
        </Modal>
      )}

      <div className={styles.formActions}>
        <Button type="submit">Сохранить</Button>
      </div>
    </form>
  )
}

/** Управление плоскими категориями KB: создать, переименовать, удалить. */
function CategoryManager({ onClose }: { onClose: () => void }) {
  const { data: categories = [] } = useKbCategories()
  const createCat = useCreateKbCategory()
  const updateCat = useUpdateKbCategory()
  const deleteCat = useDeleteKbCategory()
  const [newTitle, setNewTitle] = useState('')

  function onError(err: unknown) {
    toast(err instanceof Error ? err.message : 'Ошибка', 'error')
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    createCat.mutate(
      { title },
      { onSuccess: () => setNewTitle(''), onError },
    )
  }

  function rename(id: number, current: string) {
    const title = window.prompt('Новое название категории', current)?.trim()
    if (!title || title === current) return
    updateCat.mutate({ id, title }, { onError })
  }

  function remove(id: number) {
    if (!window.confirm('Удалить категорию? Материалы останутся без категории.')) return
    deleteCat.mutate(id, { onSuccess: () => toast('Категория удалена'), onError })
  }

  return (
    <Modal title="Категории" onClose={onClose}>
      <form onSubmit={handleAdd} className={styles.form}>
        <label className={styles.label}>
          Новая категория
          <input
            className={styles.input}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Название"
          />
        </label>
        <div className={styles.formActions}>
          <Button type="submit" disabled={!newTitle.trim()}>
            Добавить
          </Button>
        </div>
      </form>

      <div className={styles.list}>
        {categories.length === 0 && <p className="muted">Категорий пока нет</p>}
        {categories.map((cat) => (
          <div className={styles.listItem} key={cat.id}>
            <div className={styles.listItemMain}>
              <span className={styles.listTitle}>{cat.title}</span>
            </div>
            <div className={styles.listActions}>
              <Button variant="outline" onClick={() => rename(cat.id, cat.title)}>
                Переименовать
              </Button>
              <Button variant="outline" onClick={() => remove(cat.id)}>
                Удалить
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function AdminKb() {
  const { data: items = [] } = useKbItems()
  const createItem = useCreateKbItem()
  const updateItem = useUpdateKbItem()
  const deleteItem = useDeleteKbItem()

  const [createOpen, setCreateOpen] = useState(false)
  const [editItem, setEditItem] = useState<KbItemOut | null>(null)
  const [categoriesOpen, setCategoriesOpen] = useState(false)

  function openEdit(item: KbItemOut) {
    setEditItem(item)
  }

  function handleCreate(values: KbFormValues) {
    createItem.mutate(
      {
        title: values.title,
        body: values.body || null,
        published: values.published,
        category_id: values.category_id,
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
        published: values.published,
        category_id: values.category_id,
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
        <div className={styles.listActions}>
          <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
            Категории
          </Button>
          <Button onClick={() => setCreateOpen(true)}>Создать</Button>
        </div>
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

      {categoriesOpen && <CategoryManager onClose={() => setCategoriesOpen(false)} />}
    </div>
  )
}
