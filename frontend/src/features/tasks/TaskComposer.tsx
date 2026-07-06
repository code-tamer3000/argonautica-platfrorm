import { useState } from 'react'
import { useCreateSubmission } from '../../api/tasks'
import { Button } from '../../components/Button'
import { MediaComposer, type MediaChip } from '../../components/MediaComposer'
import { toast } from '../../stores/toast'
import styles from './tasks.module.css'

export function TaskComposer({ taskId }: { taskId: number }) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<MediaChip[]>([])
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
          toast('Сдано')
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Не удалось отправить', 'error'),
      },
    )
  }

  const canSend = !!text.trim() || attachments.length > 0

  return (
    <div className={styles.composer}>
      <MediaComposer
        value={text}
        onChange={setText}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        placeholder="Опишите вашу работу (поддерживается Markdown)…"
        disabled={create.isPending}
      />
      <div className={styles.composerActions}>
        <Button type="button" onClick={submit} disabled={!canSend || create.isPending}>
          {create.isPending ? 'Отправка…' : 'Сдать работу'}
        </Button>
      </div>
    </div>
  )
}
