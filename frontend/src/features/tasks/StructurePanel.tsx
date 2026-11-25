import { useEffect, useState } from 'react'
import {
  useAddStructureEntry, useAdminAssignments, useReview, useTask,
  type StructureEntry, type StructureQuestion, type TaskTrackOut, type TaskWithStatusOut,
} from '../../api/tasks'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Overlay'
import { toast } from '../../stores/toast'
import styles from '../cabin/cabin.module.css'

const entryDate = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
})

export function EntryList({ questions, entries }: {
  questions: StructureQuestion[]
  entries: StructureEntry[]
}) {
  const firstText = questions.find(q => q.kind === 'text')
  return <div className={styles.list}>
    {entries.map((entry, i) => {
      const title = firstText ? entry.answers?.[firstText.id] : null
      return <details key={entry.id} className={styles.dateGroup}>
        <summary className={styles.entrySummary}>{title ?? `Запись ${i + 1} · ${entryDate.format(new Date(entry.created_at))}`}</summary>
        <dl className={styles.entryAnswers}>
          {questions.map(q => <div key={q.id}>
            <dt>{q.label}</dt><dd>{entry.answers?.[q.id]}{q.kind === 'scale' && ' / 10'}</dd>
          </div>)}
        </dl>
      </details>
    }).reverse()}
  </div>
}

function Accept({ taskId, track }: { taskId: number; track: TaskTrackOut }) {
  const review = useReview()
  return <Button disabled={review.isPending} onClick={() =>
    review.mutate({ taskId, assignmentId: track.assignment_id, action: 'accept' }, {
      onError: err => toast(err.message, 'error'),
    })}>Принять</Button>
}

export function StructureReview({ taskId, track }: { taskId: number; track: TaskTrackOut }) {
  const { data: task } = useTask(taskId)
  if (!task?.questions) return null
  return <>
    <EntryList questions={task.questions} entries={track.submissions} />
    {track.status === 'submitted' && <Accept taskId={taskId} track={track} />}
  </>
}

function EntryForm({ task, close }: { task: TaskWithStatusOut; close: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string | number>>({})
  const add = useAddStructureEntry(task.id)
  return <Modal title="Добавить запись" onClose={close} closeOnBackdrop={false}>
    <form className={styles.list} onSubmit={e => {
      e.preventDefault()
      add.mutate(answers, { onSuccess: close, onError: err => toast(err.message, 'error') })
    }}>
      {task.questions?.map(q => <label className={styles.list} key={q.id}>{q.label}
        {q.kind === 'text'
          ? <textarea required rows={3} value={answers[q.id] ?? ''} onChange={e =>
              setAnswers({ ...answers, [q.id]: e.target.value })} />
          : <select required value={answers[q.id] ?? ''} onChange={e =>
              setAnswers({ ...answers, [q.id]: Number(e.target.value) })}>
              <option value="" disabled>От 1 до 10</option>
              {Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select>}
      </label>)}
      <Button type="submit" disabled={add.isPending}>Сохранить запись</Button>
    </form>
  </Modal>
}

export function StructurePanel({ task, tracks, isAdmin, canWrite }: {
  task: TaskWithStatusOut; tracks: TaskTrackOut[]; isAdmin: boolean; canWrite: boolean
}) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  const deadline = Date.parse(task.deadline_at!)
  useEffect(() => {
    // Browser timers are limited to roughly 24 days.
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      if (now < deadline) setNow(Date.now())
      return
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.min(remaining, 2_000_000_000))
    return () => clearTimeout(timer)
  }, [deadline, now])
  const ended = now >= deadline
  const roster = useAdminAssignments(isAdmin ? task.id : 0)
  const questions = task.questions ?? []
  if (isAdmin) return <section className={styles.list}>
    <h3>Работы участников</h3>
    {roster.data?.map(row => {
      const track = tracks.find(t => t.user_id === row.user_id)
      return <details key={row.user_id} className={styles.dateGroup}>
        <summary className={styles.entrySummary}>{row.display_name} · {row.submission_count
          ? `Записей: ${row.submission_count}` : ended ? 'Не выполнено' : 'Нет записей'}</summary>
        {track && <div className={styles.dateItems}>
          <EntryList questions={questions} entries={track.submissions} />
          {track.status === 'accepted' ? 'Принята' : ended && <Accept taskId={task.id} track={track} />}
        </div>}
      </details>
    })}
  </section>
  const track = tracks[0]
  return <section className={styles.list}>
    <h3>Мои записи</h3>
    <EntryList questions={questions} entries={track?.submissions ?? []} />
    {ended || track?.status === 'accepted'
      ? <p>{track?.status === 'accepted' ? 'Принята' : track ? 'На проверке' : 'Не выполнено · нет записей'}</p>
      : canWrite && <Button className={styles.addBtn} onClick={() => setOpen(true)}>Добавить запись</Button>}
    {open && !ended && <EntryForm task={task} close={() => setOpen(false)} />}
  </section>
}
