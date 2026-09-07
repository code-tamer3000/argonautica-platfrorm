import { useRef, useState } from 'react'
import { useAdminIntakes } from '../../api/admin'
import { useAttachKbMedia, useDetachKbMedia, useKbCategories, useKbItem } from '../../api/kb'
import { useAdminPlans } from '../../api/plans'
import type { KbItemOut } from '../../lib/types'
import { mediaUpload, isUploadAbort } from '../../lib/mediaUpload'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { Attachment } from '../chat/Attachment'
// Форма создания/редактирования материала БЗ — перенесена из features/admin/AdminKb
// в основной раздел «База знаний» (админ-действия теперь живут там, не в «Управлении»).
// Стили намеренно остаются админскими: форма живёт в модалке, а не в общем макете страницы.
import styles from '../admin/admin.module.css'

export interface KbFormValues {
  title: string
  body: string
  published: boolean
  category_id: number | null
  media_asset_ids: number[]
  intake_id: number | null
  plan_ids: number[]
}

interface KbFormProps {
  initial?: KbItemOut
  onSubmit: (values: KbFormValues) => void
  /** Существующий материал: медиа прикрепляем/открепляем сразу через API.
      Без него (создание) — складываем id загруженных файлов и отдаём в onSubmit. */
  item?: KbItemOut
}

export function KbForm({ initial, onSubmit, item }: KbFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [published, setPublished] = useState(initial?.published ?? false)
  const [categoryId, setCategoryId] = useState<number | null>(initial?.category_id ?? null)
  const [intakeId, setIntakeId] = useState<number | null>(initial?.intake_id ?? null)
  const [planIds, setPlanIds] = useState<number[]>(initial?.plan_ids ?? [])
  const { data: categories = [] } = useKbCategories()
  const { data: intakes = [] } = useAdminIntakes()
  const { data: plans = [] } = useAdminPlans()
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
    onSubmit({
      title,
      body,
      published,
      category_id: categoryId,
      media_asset_ids: stagedMedia,
      intake_id: intakeId,
      plan_ids: planIds,
    })
  }

  function togglePlan(planId: number) {
    setPlanIds((prev) =>
      prev.includes(planId) ? prev.filter((id) => id !== planId) : [...prev, planId],
    )
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
      <label className={styles.label}>
        Набор
        <select
          className={styles.input}
          value={intakeId ?? ''}
          onChange={(e) => setIntakeId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Общий для всех потоков</option>
          {intakes.map((intake) => (
            <option key={intake.id} value={intake.id}>
              {intake.starts_on} – {intake.ends_on}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.label}>
        Тарифы
        {plans.length === 0 ? (
          <p className={styles.mediaEmpty}>Тарифов пока нет</p>
        ) : (
          <div className={styles.list}>
            {plans.map((plan) => (
              <label key={plan.id} className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={planIds.includes(plan.id)}
                  onChange={() => togglePlan(plan.id)}
                />
                {plan.name}
              </label>
            ))}
          </div>
        )}
        <p className={styles.mediaEmpty}>Ничего не выбрано — доступен всем тарифам потока</p>
      </div>
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
              <div className={styles.uploadBarFill} style={{ transform: `scaleX(${progress / 100})` }} />
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
