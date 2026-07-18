import { useRef, useState, type ChangeEvent, type FocusEvent } from 'react'
import { mediaUpload } from '../lib/mediaUpload'
import type { MediaKind } from '../lib/types'
import { toast } from '../stores/toast'
import { Button } from './Button'
import { IconAttach } from './icons'
import styles from './mediaComposer.module.css'

const KIND_LABEL: Record<MediaKind, string> = {
  image: 'Изображение',
  video: 'Видео',
  audio: 'Аудио',
  file: 'Файл',
}

/** Минимальный тип вложения для отображения чипа и отправки id. */
export interface MediaChip {
  id: number
  kind: MediaKind
}

interface Props {
  /** Текст (Markdown) — контролируется родителем. */
  value: string
  onChange: (v: string) => void
  /** Список вложений — контролируется родителем (он же их отправляет). */
  attachments: MediaChip[]
  onAttachmentsChange: (a: MediaChip[]) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
}

/**
 * Единый переиспользуемый медиа-композер: textarea (Markdown) + прикрепление
 * фото/видео/аудио/файлов с прогрессом загрузки и чипами «ожидающих» вложений.
 *
 * Текст и СПИСОК вложений контролируются родителем (он их и сабмитит). Состояние
 * загрузки (uploading/progress) композер держит сам. Кнопку отправки НЕ рисует —
 * её добавляет родитель (сдача участника / форма админа).
 */
export function MediaComposer({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  placeholder,
  rows = 4,
  disabled = false,
}: Props) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    setProgress(0)
    try {
      const { asset } = await mediaUpload(file, (f) => setProgress(Math.round(f * 100)))
      onAttachmentsChange([...attachments, { id: asset.id, kind: asset.kind }])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки файла', 'error')
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  function removeAttachment(id: number) {
    onAttachmentsChange(attachments.filter((a) => a.id !== id))
  }

  // После анимации открытия клавиатуры (iOS/Android) прокручиваем textarea в
  // видимую область ближайшего скроллируемого контейнера.
  function handleFocus(e: FocusEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget
    setTimeout(() => {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 350)
  }

  return (
    <div className={styles.composer}>
      <textarea
        ref={textareaRef}
        className={styles.input}
        placeholder={placeholder ?? 'Текст (поддерживается Markdown)…'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={handleFocus}
        rows={rows}
        disabled={disabled}
      />

      {attachments.length > 0 && (
        <div className={styles.pendingAtt}>
          {attachments.map((a) => (
            <span key={a.id} className={styles.pendingChip}>
              <IconAttach size={13} />
              <span className={styles.pendingChipLabel}>{KIND_LABEL[a.kind] ?? 'Файл'}</span>
              <button
                className={styles.pendingChipX}
                type="button"
                onClick={() => removeAttachment(a.id)}
                aria-label="Убрать вложение"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {progress !== null && (
        <div className={styles.uploadProgress}>
          <div className={styles.uploadBar}>
            <div className={styles.uploadBarFill} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.uploadPct}>{progress}%</span>
        </div>
      )}

      {/* tabIndex={-1}: убирает скрытый file input из навигации iOS-тулбара клавиатуры */}
      <input ref={fileRef} type="file" hidden tabIndex={-1} onChange={handleFileChange} />

      <div className={styles.actions}>
        <Button
          className={styles.attachBtn}
          variant="outline"
          type="button"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Загрузка…' : 'Прикрепить файл'}
        </Button>
      </div>
    </div>
  )
}
