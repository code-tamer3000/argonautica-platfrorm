import { useState } from 'react'
import { useCreateSubmission } from '../../api/tasks'
import { Button } from '../../components/Button'
import { MediaComposer, type MediaChip } from '../../components/MediaComposer'
import { Modal } from '../../components/Overlay'
import { toast } from '../../stores/toast'
import styles from './tasks.module.css'

// Порог штрафов до Междумирья (ARG-128 «Готово, когда») — держим в одном
// месте, синхронно с текстом.
const LATE_SUBMISSIONS_LIMIT = 3

// Предупреждение при сдаче после дедлайна: «примем, но не бесконечно» — по
// образцу LimboPopup.tsx (features/app), только без персистентного дизмисса —
// закрыть здесь значит «не показывать повторно в рамках этой сдачи».
function LateSubmissionPopup({ count, onClose }: { count: number; onClose: () => void }) {
  const remaining = Math.max(0, LATE_SUBMISSIONS_LIMIT - count)
  return (
    <Modal title="Сдано позже срока" onClose={onClose} closeOnBackdrop={false}>
      <p className={styles.lateWarningText}>
        Мы приняли эту работу, хотя срок уже прошёл.
      </p>
      <p className={styles.lateWarningText}>
        {remaining > 0
          ? `Ещё ${remaining} ${remaining === 1 ? 'такая просрочка' : 'таких просрочки'} — и ты окажешься в Междумирье.`
          : 'Лимит поздних сдач исчерпан — следующая просрочка отправит тебя в Междумирье.'}
      </p>
      <Button variant="gold" onClick={onClose}>Понял</Button>
    </Modal>
  )
}

export function TaskComposer({
  taskId,
  status,
  onSubmitted,
}: {
  taskId: number
  /** Статус трека участника, если он уже сдавал; иначе undefined. */
  status?: string
  /** Доп. колбэк после успешной сдачи — например, обновить данные вне очереди
   * задач (страница «Аргонавты» читает текст сдачи из совсем другого запроса). */
  onSubmitted?: () => void
}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<MediaChip[]>([])
  // Уже сдавал (submitted/accepted) — форма скрыта под кнопкой «Редактировать».
  const submitted = status === 'submitted' || status === 'accepted'
  const [editing, setEditing] = useState(false)
  const [lateWarning, setLateWarning] = useState<number | null>(null)
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
        onSuccess: (result) => {
          setText('')
          setAttachments([])
          setEditing(false)
          toast('Сдано')
          onSubmitted?.()
          if (result.late) setLateWarning(result.late_submissions_count)
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Не удалось отправить', 'error'),
      },
    )
  }

  const canSend = !!text.trim() || attachments.length > 0
  const popup = lateWarning != null && (
    <LateSubmissionPopup count={lateWarning} onClose={() => setLateWarning(null)} />
  )

  // Уже сдавал и не в режиме редактирования — показываем только «Редактировать».
  // Попап рендерим и в этой свёрнутой ветке — сразу после сдачи `submitted`
  // становится true в тот же тик, что и открытие предупреждения.
  if (submitted && !editing) {
    return (
      <>
        {popup}
        <div className={styles.composerActions}>
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            Редактировать
          </Button>
        </div>
      </>
    )
  }

  return (
    <div className={styles.composer}>
      {popup}
      <MediaComposer
        value={text}
        onChange={setText}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        placeholder="Дай здесь свой ответ"
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
