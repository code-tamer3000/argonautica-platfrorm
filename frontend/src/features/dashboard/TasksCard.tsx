import { differenceInCalendarDays } from 'date-fns'
import { Link } from 'react-router-dom'
import type { ProgressOut, TaskWithStatusOut } from '../../api/tasks'
import { Card } from '../../components/Card'
import { Chip } from '../../components/Chip'
import { EmptyState } from '../../components/EmptyState'
import { plural } from '../../lib/format'
import styles from './dashboard.module.css'

interface Props {
  activeTasks: TaskWithStatusOut[]
  progress: ProgressOut | null
  inReview: number
}

/** «сегодня» / «завтра» / «через N дней» / «срок прошёл» / «без срока» — обратный
 * отсчёт вместо календарной даты: единственный элемент, которому позволено
 * подталкивать «не пропускай», без тревожного цвета (см. план ARG — витрина
 * задач на главной, тон только положительный). */
function deadlineLabel(iso: string): string {
  const days = differenceInCalendarDays(new Date(iso), new Date())
  if (days < 0) return 'срок прошёл'
  if (days === 0) return 'сегодня'
  if (days === 1) return 'завтра'
  return `через ${days} ${plural(days, ['день', 'дня', 'дней'])}`
}

function isOverdue(task: TaskWithStatusOut): boolean {
  return task.deadline_at != null && new Date(task.deadline_at).getTime() < Date.now()
}

// Приоритет строки в списке: 0 — самый заметный (выше). Возвращённая задача важнее
// просроченной (её уже смотрели и отправили обратно — это прямое действие от юзера,
// а не просто тикающие часы); дальше горящий срок, дальше всё остальное как пришло.
function rowPriority(task: TaskWithStatusOut): number {
  if (task.my_status === 'returned') return 0
  if (isOverdue(task)) return 1
  if (task.deadline_soon) return 2
  return 3
}

function TaskRow({ task }: { task: TaskWithStatusOut }) {
  const when = task.deadline_at ? deadlineLabel(task.deadline_at) : 'без срока'
  const returned = task.my_status === 'returned'
  const overdue = isOverdue(task)
  const flagged = returned || overdue || task.deadline_soon

  return (
    <Link to={`/tasks/${task.id}`} className={flagged ? `${styles.item} ${styles.itemFlag}` : styles.item}>
      <span className={overdue ? `${styles.itemWhen} ${styles.itemWhenMuted}` : styles.itemWhen}>{when}</span>
      <span className={styles.itemBody}>
        <span className={styles.itemTitle}>{task.title}</span>
        <span className={styles.itemMeta}>
          {returned ? 'вернули на доработку' : overdue ? 'ещё можно сдать' : 'не сдано'}
        </span>
      </span>
      {returned ? (
        <Chip kind="returned">Возвращена</Chip>
      ) : overdue ? (
        <Chip kind="overdue">Просрочено</Chip>
      ) : task.deadline_soon ? (
        <Chip kind="soon">Подходит срок</Chip>
      ) : null}
    </Link>
  )
}

/** Ядро прогресса «X/Y» — дуга поверх кольца, читается как маленькая победа, а
 * не как долг: полностью закрашенное кольцо — это цель, не порог тревоги. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const size = 56
  const stroke = 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = total > 0 ? done / total : 0

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.taskRing}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--divider)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className={styles.taskRingLabel}>
        {done}/{total}
      </text>
    </svg>
  )
}

// Возвращённые и просроченные — наверх (стабильно, в пределах группы порядок как
// пришёл с бэка: сперва по дедлайну, потом без него по created_at desc).
function sortByAttention(tasks: TaskWithStatusOut[]): TaskWithStatusOut[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => rowPriority(a.task) - rowPriority(b.task) || a.index - b.index)
    .map(({ task }) => task)
}

export function TasksCard({ activeTasks, progress, inReview }: Props) {
  const sortedTasks = sortByAttention(activeTasks)
  const footer =
    progress == null || progress.total === 0
      ? null
      : progress.done === progress.total
        ? 'Все задания сданы'
        : inReview > 0
          ? `На проверке: ${inReview} — ждём ответа`
          : `${progress.done} из ${progress.total} позади`

  return (
    <Card accent>
      <div className={styles.cardHead}>
        <h3>Задания экспедиции</h3>
        <span className={styles.cardHeadSpacer} />
        <Link to="/tasks" className={styles.cardMore}>
          Все задачи
        </Link>
      </div>

      {progress != null && progress.total > 0 && (
        <div className={styles.taskProgressRow}>
          <ProgressRing done={progress.done} total={progress.total} />
          <div className={styles.taskProgressText}>
            <span>принято заданий</span>
            {inReview > 0 && <span className={styles.itemMeta}>на проверке: {inReview}</span>}
          </div>
        </div>
      )}

      {sortedTasks.length === 0 ? (
        <EmptyState size="inline">Все задания сданы ✦</EmptyState>
      ) : (
        <div className={styles.list}>
          {sortedTasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}

      {footer && <p className={styles.taskFoot}>{footer}</p>}
    </Card>
  )
}
