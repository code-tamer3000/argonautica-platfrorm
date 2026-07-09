import { Link } from 'react-router-dom'
import { useTasks, type MyTaskStatus, type TaskType, type TaskWithStatusOut } from '../../api/tasks'
import { Spinner } from '../../components/Spinner'
import { dayLabel } from '../../lib/format'
import styles from './tasks.module.css'

const TYPE_LABEL: Record<TaskType, string> = {
  common: 'Общая',
  individual: 'Индивидуальная',
}

const STATUS_LABEL: Record<Exclude<MyTaskStatus, null>, string> = {
  assigned: 'Назначена',
  submitted: 'На проверке',
  returned: 'Возвращена',
  accepted: 'Принята',
}

function statusChipClass(status: MyTaskStatus): string {
  if (status === 'accepted') return `${styles.chip} ${styles.chipAccepted}`
  if (status === 'returned') return `${styles.chip} ${styles.chipReturned}`
  return styles.chip
}

function TaskCard({ task }: { task: TaskWithStatusOut }) {
  return (
    <Link to={`/tasks/${task.id}`} className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{task.title}</span>
        <span className={`${styles.badge} ${styles.badgeType}`}>{TYPE_LABEL[task.type]}</span>
      </div>
      <div className={styles.cardChips}>
        {task.my_status && (
          <span className={statusChipClass(task.my_status)}>
            {STATUS_LABEL[task.my_status]}
          </span>
        )}
        {task.deadline_soon && <span className={`${styles.chip} ${styles.chipSoon}`}>Подходит срок</span>}
        {task.late && <span className={`${styles.chip} ${styles.chipLate}`}>Сдано позже</span>}
      </div>
      {task.deadline_at && (
        <div className={styles.cardMeta}>Дедлайн: {dayLabel(task.deadline_at)}</div>
      )}
    </Link>
  )
}

export function TasksList() {
  const { data, isLoading } = useTasks()

  const items = data?.items ?? []
  const progress = data?.progress
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  // Выполненные — принятые админом; остальные (назначена / на проверке /
  // возвращена / без статуса) считаются активными.
  const active = items.filter((t) => t.my_status !== 'accepted')
  const done = items.filter((t) => t.my_status === 'accepted')

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Задачи</h1>

      {progress && progress.total > 0 && (
        <div className={styles.progressBar}>
          <span className={styles.progressLabel}>
            Выполнено {progress.done} из {progress.total}
          </span>
          <span className={styles.progressTrack}>
            <span className={styles.progressFill} style={{ width: `${pct}%` }} />
          </span>
        </div>
      )}

      {isLoading && <div className="center" style={{ padding: 40 }}><Spinner /></div>}
      {!isLoading && items.length === 0 && (
        <div className="center muted" style={{ padding: 40 }}>Задач пока нет</div>
      )}

      {active.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Активные</h2>
          <div className={styles.grid}>
            {active.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Выполненные</h2>
          <div className={styles.grid}>
            {done.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
