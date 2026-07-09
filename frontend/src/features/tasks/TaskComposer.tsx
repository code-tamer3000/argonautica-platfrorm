import { useState } from 'react'
import { useCreateSubmission } from '../../api/tasks'
import { Button } from '../../components/Button'
import { MediaComposer, type MediaChip } from '../../components/MediaComposer'
import { toast } from '../../stores/toast'
import styles from './tasks.module.css'

export function TaskComposer({
  taskId,
  status,
}: {
  taskId: number
  /** Статус трека участника, если он уже сдавал; иначе undefined. */
  status?: string
}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<MediaChip[]>([])
  // Уже сдавал (submitted/accepted) — форма скрыта под кнопкой «Редактировать».
  const submitted = status === 'submitted' || status === 'accepted'
  const [editing, setEditing] = useState(false)
  const create = useCreateSubmission(taskId)

  function submit() {
    const body = text.trim()
    if (!body && attachments.length === 0) return
    if (create.isPending) return
    create.mutate(
      {
        body: body || null,
        attachment_ids: attachments.length ? attachments.map((a) => a.id) : undefined,
      },
      {
        onSuccess: () => {
          setText('')
          setAttachments([])
          setEditing(false)
          toast('Сдано')
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Не удалось отправить', 'error'),
      },
    )
  }

  const canSend = !!text.trim() || attachments.length > 0

  // Уже сдавал и не в режиме редактирования — показываем только «Редактировать».
  if (submitted && !editing) {
    return (
      <div className={styles.composerActions}>
        <Button type="button" variant="outline" onClick={() => setEditing(true)}>
          Редактировать
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.composer}>
      <MediaComposer
        value={text}
        onChange={setText}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        placeholder="Опишите вашу работу…"
        disabled={create.isPending}
      />
      <div className={styles.composerActions}>
        <Button type="button" onClick={submit} disabled={!canSend || create.isPending}>
          {create.isPending ? 'Отправка…' : submitted ? 'Сохранить' : 'Сдать работу'}
        </Button>
        {submitted && (
          <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={create.isPending}>
            Отмена
          </Button>
        )}
      </div>
    </div>
  )
}
