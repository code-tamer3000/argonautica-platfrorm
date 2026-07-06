import { useRef, useState, type ChangeEvent } from 'react'
import { useCreateSubmission } from '../../api/tasks'
import { Button } from '../../components/Button'
import { IconAttach } from '../../components/icons'
import { mediaUpload } from '../../lib/mediaUpload'
import type { MediaAssetOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import styles from './tasks.module.css'

const KIND_LABEL: Record<string, string> = {
  image: 'Изображение',
  video: 'Видео',
  audio: 'Аудио',
  file: 'Файл',
}

export function TaskComposer({ taskId }: { taskId: number }) {
  const [text, setText] = useState('')
  const [pendingFiles, setPendingFiles] = useState<MediaAssetOut[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const create = useCreateSubmission(taskId)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    setProgress(0)
    try {
      const asset = await mediaUpload(file, (f) => setProgress(Math.round(f * 100)))
      setPendingFiles((prev) => [...prev, asset])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки файла', 'error')
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  function submit() {
    const body = text.trim()
    if (!body && pendingFiles.length === 0) return
    if (create.isPending) return
    create.mutate(
      {
        body: body || null,
        attachment_ids: pendingFiles.length ? pendingFiles.map((a) => a.id) : undefined,
      },
      {
        onSuccess: () => {
          setText('')
          setPendingFiles([])
          toast('Сдано')
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Не удалось отправить', 'error'),
      },
    )
  }

  const canSend = !!text.trim() || pendingFiles.length > 0

  return (
    <div className={styles.composer}>
      <textarea
        className={styles.composerInput}
        placeholder="Опишите вашу работу (поддерживается Markdown)…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
      />

      {pendingFiles.length > 0 && (
        <div className={styles.pendingAtt}>
          {pendingFiles.map((a) => (
            <span key={a.id} className={styles.pendingChip}>
              <IconAttach size={13} />
              <span className={styles.pendingChipLabel}>{KIND_LABEL[a.kind] ?? 'Файл'}</span>
              <button
                className={styles.pendingChipX}
                type="button"
                onClick={() => setPendingFiles((prev) => prev.filter((f) => f.id !== a.id))}
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

      <input ref={fileRef} type="file" hidden onChange={handleFileChange} />

      <div className={styles.composerActions}>
        <Button
          className={styles.attachBtn}
          variant="outline"
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Загрузка…' : 'Прикрепить файл'}
        </Button>
        <Button type="button" onClick={submit} disabled={!canSend || create.isPending}>
          {create.isPending ? 'Отправка…' : 'Сдать работу'}
        </Button>
      </div>
    </div>
  )
}
