import { Link } from 'react-router-dom'
import {
  useAdminAssignments,
  useTasks,
  type MyTaskStatus,
  type TaskType,
  type TaskWithStatusOut,
} from '../../api/tasks'
import { useUsersMap } from '../../api/users'
import { useAuth } from '../auth/AuthContext'
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

// Истёкшая = есть дедлайн в прошлом.
function isOverdue(task: TaskWithStatusOut): boolean {
  return task.deadline_at != null && new Date(task.deadline_at).getTime() < Date.now()
}

// Кому назначена индивидуальная задача (для админа в боковой панели «Задачи»).
function AssigneeChips({ taskId }: { taskId: number }) {
  const { data: assignments = [], isLoading } = useAdminAssignments(taskId)
  const users = useUsersMap()
  if (isLoading || assignments.length === 0) return null
  return (
    <div className={styles.cardChips}>
      {assignments.map((a) => (
        <span key={a.assignment_id} className={`${styles.chip}`}>
          {users.get(a.user_id)?.display_name ?? `Участник #${a.user_id}`}
        </span>
      ))}
    </div>
  )
}

function TaskCard({ task, isAdmin }: { task: TaskWithStatusOut; isAdmin: boolean }) {
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
      {isAdmin && task.type === 'individual' && <AssigneeChips taskId={task.id} />}
      {task.deadline_at && (
        <div className={styles.cardMeta}>Дедлайн: {dayLabel(task.deadline_at)}</div>
      )}
    </Link>
  )
}

export function TasksList() {
  const { data, isLoading } = useTasks()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const items = data?.items ?? []

  // Админ (боковая панель «Задачи») делит по сроку: активные vs истёкшие.
  // Участник — по своему статусу: активные vs выполненные (принятые).
  const [firstItems, secondItems] = isAdmin
    ? [items.filter((t) => !isOverdue(t)), items.filter(isOverdue)]
    : [items.filter((t) => t.my_status !== 'accepted'), items.filter((t) => t.my_status === 'accepted')]
  const secondTitle = isAdmin ? 'Истёк срок' : 'Выполненные'

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Задачи</h1>

      {isLoading && <div className="center" style={{ padding: 40 }}><Spinner /></div>}
      {!isLoading && items.length === 0 && (
        <div className="center muted" style={{ padding: 40 }}>Задач пока нет</div>
      )}

      {firstItems.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Активные</h2>
          <div className={styles.grid}>
            {firstItems.map((task) => (
              <TaskCard key={task.id} task={task} isAdmin={isAdmin} />
            ))}
          </div>
        </section>
      )}

      {secondItems.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{secondTitle}</h2>
          <div className={styles.grid}>
            {secondItems.map((task) => (
              <TaskCard key={task.id} task={task} isAdmin={isAdmin} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
