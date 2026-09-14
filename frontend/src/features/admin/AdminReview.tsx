import { useState } from 'react'
import { useReviewQueue, useTaskSubmissions } from '../../api/tasks'
import { Avatar } from '../../components/Avatar'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import { TrackCard } from '../tasks/TaskDetail'
import taskStyles from '../tasks/tasks.module.css'
import styles from './admin.module.css'

const TASK_TYPE_LABEL: Record<string, string> = {
  common: 'Общая',
  individual: 'Индивидуальная',
  pair: 'Парная',
  stream: 'Поток',
}

function dateTime(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Строка очереди раскрывается в тот же TrackCard, что и на карточке задачи —
// подгружает треки задачи лениво (только при раскрытии), фильтрует до своего
// assignment_id, чтобы не тащить в разметку остальные сдачи той же задачи.
function QueueRow({
  assignmentId,
  taskId,
  taskTitle,
  taskType,
  displayName,
  avatarUrl,
  submittedAt,
  late,
}: {
  assignmentId: number
  taskId: number
  taskTitle: string
  taskType: string
  displayName: string
  avatarUrl: string | null
  submittedAt: string
  late: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const { data: tracks, isLoading } = useTaskSubmissions(expanded ? taskId : 0)
  const track = tracks?.find((t) => t.assignment_id === assignmentId)

  return (
    <div className={styles.listItem}>
      <button
        type="button"
        className={styles.listItemMain}
        style={{ cursor: 'pointer', width: '100%', textAlign: 'left', background: 'none', border: 'none' }}
        onClick={() => setExpanded((v) => !v)}
      >
        <Avatar name={displayName} url={avatarUrl} size={28} />
        <span className={styles.listTitle}>
          {displayName} — {taskTitle}
          {late && ' · сдано позже'}
        </span>
        <span className={styles.listMeta}>
          {TASK_TYPE_LABEL[taskType] ?? taskType} · {dateTime(submittedAt)}
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          {isLoading || !track ? (
            <div className="center" style={{ padding: 'var(--space-3)' }}><Spinner size={16} /></div>
          ) : (
            <div className={taskStyles.section} style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
              <TrackCard track={track} taskId={taskId} isAdmin />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AdminReview() {
  const { data: items = [], isLoading } = useReviewQueue()

  if (isLoading) return <div className="center grow"><Spinner /></div>

  return (
    <div className={styles.page}>
      <PageHeader title="Проверка">
        <span style={{ fontSize: 'var(--text-ui)', color: 'var(--text-ghost)' }}>
          {items.length} на проверке
        </span>
      </PageHeader>

      {items.length === 0 ? (
        <p className={styles.mediaEmpty}>Нечего проверять — все сдачи рассмотрены.</p>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <QueueRow
              key={item.assignment_id}
              assignmentId={item.assignment_id}
              taskId={item.task_id}
              taskTitle={item.task_title}
              taskType={item.task_type}
              displayName={item.display_name}
              avatarUrl={item.avatar_url}
              submittedAt={item.submitted_at}
              late={item.late}
            />
          ))}
        </div>
      )}
    </div>
  )
}
