import { useState } from 'react'
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
import { BackButton } from '../../components/BackButton'
import ph from '../../components/pageHeader.module.css'
import { Spinner } from '../../components/Spinner'
import { Badge } from '../../components/Badge'
import { Chip, type ChipKind } from '../../components/Chip'
import { cardClass } from '../../components/Card'
import { dayLabel } from '../../lib/format'
import { useUiStore } from '../../stores/ui'
import styles from './tasks.module.css'

const TYPE_LABEL: Record<TaskType, string> = {
  common: 'Общая',
  individual: 'Индивидуальная',
  pair: 'Парная',
  stream: 'Поток',
}

const STATUS_LABEL: Record<Exclude<MyTaskStatus, null>, string> = {
  assigned: 'Назначена',
  submitted: 'На проверке',
  returned: 'Возвращена',
  accepted: 'Принята',
}

function statusChipKind(status: MyTaskStatus): ChipKind {
  if (status === 'accepted') return 'accepted'
  if (status === 'returned') return 'returned'
  return 'neutral'
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
        <Chip key={a.assignment_id}>
          {users.get(a.user_id)?.display_name ?? `Участник #${a.user_id}`}
        </Chip>
      ))}
    </div>
  )
}

function TaskCard({ task, isAdmin }: { task: TaskWithStatusOut; isAdmin: boolean }) {
  return (
    <Link to={`/tasks/${task.id}`} className={cardClass({ interactive: true })}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{task.title}</span>
        <Badge tone="accent">{TYPE_LABEL[task.type]}</Badge>
      </div>
      <div className={styles.cardChips}>
        {task.my_status && (
          <Chip kind={statusChipKind(task.my_status)}>
            {STATUS_LABEL[task.my_status]}
          </Chip>
        )}
        {task.deadline_soon && <Chip kind="soon">Подходит срок</Chip>}
        {task.late && <Chip kind="late">Сдано позже</Chip>}
      </div>
      {isAdmin && (
        <div className={styles.progressRow}>
          <span className={styles.progressStat}>
            сдали {task.submitted_count} из {task.total_recipients}
          </span>
          {task.unreviewed_count > 0 && (
            <Chip kind="unreviewed">
              {task.unreviewed_count} на проверке
            </Chip>
          )}
        </div>
      )}
      {isAdmin && task.type === 'individual' && <AssigneeChips taskId={task.id} />}
      {task.deadline_at && (
        <div className={styles.cardMeta}>Дедлайн: {dayLabel(task.deadline_at)}</div>
      )}
    </Link>
  )
}

// Сворачиваемая секция списка. Раскрытой по умолчанию оставляем только одну
// (активные общие) — остальных задач у админа кратно больше, и они топят главное.
function CollapsibleSection({
  title,
  tasks,
  isAdmin,
  defaultOpen = false,
}: {
  title: string
  tasks: TaskWithStatusOut[]
  isAdmin: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (tasks.length === 0) return null
  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.sectionToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {title}
        <span className={styles.sectionCount}>{tasks.length}</span>
      </button>
      {open && (
        <div className={styles.grid}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </section>
  )
}

export function TasksList() {
  const { data, isLoading } = useTasks()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // «Текущая экспедиция» (ARG-104): для admin этот экран не гейтится сервером
  // вообще (полный доступ) — сужаем отображение тем же общим контекстом, что и
  // /admin/tasks. Индивидуальные/парные/потоковые задачи всегда intake_id=NULL
  // (видимость на назначении, не потоке) — фильтр их не трогает. Выбирается ОДИН
  // раз в /admin/expeditions, здесь только читаем — без своего контрола/баннера.
  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const intakeFiltered = isAdmin && currentIntakeId != null

  const allItems = data?.items ?? []
  const items = intakeFiltered
    ? allItems.filter((t) => t.intake_id == null || t.intake_id === currentIntakeId)
    : allItems

  // Участник — по своему статусу: активные vs выполненные (принятые).
  const mine = items.filter((t) => t.my_status !== 'accepted')
  const mineDone = items.filter((t) => t.my_status === 'accepted')

  // Админ: активные режем по типу, чтобы общие не тонули среди индивидуальных и
  // перекрёстных (последних — по 2 на каждую пару задания).
  const activeItems = items.filter((t) => !isOverdue(t))
  const overdue = items.filter(isOverdue)
  const activeCross = activeItems.filter((t) => t.pair_id != null)
  const activeMain = activeItems.filter((t) => t.pair_id == null)
  const activeCommon = activeMain.filter((t) => t.type === 'common')
  const activeIndividual = activeMain.filter((t) => t.type === 'individual')
  const activeGroup = activeMain.filter((t) => t.type === 'pair' || t.type === 'stream')

  return (
    <div className={styles.page}>
      <div className={`${ph.titleRow} ${styles.titleRow}`}>
        <BackButton />
        <h1 className={styles.pageTitle}>Задачи</h1>
      </div>

      {isLoading && <div className="center" style={{ padding: 40 }}><Spinner /></div>}
      {!isLoading && allItems.length === 0 && (
        <div className="center muted" style={{ padding: 40 }}>Задач пока нет</div>
      )}
      {!isLoading && allItems.length > 0 && items.length === 0 && (
        <div className="center muted" style={{ padding: 40 }}>В этом потоке задач нет</div>
      )}

      {isAdmin ? (
        <>
          {activeCommon.length > 0 && (
            <section className={styles.section}>
              <h2 className={`${styles.sectionTitle} ${styles.sectionTitleActive}`}>
                Активные общие
              </h2>
              <div className={styles.grid}>
                {activeCommon.map((task) => (
                  <TaskCard key={task.id} task={task} isAdmin />
                ))}
              </div>
            </section>
          )}
          <CollapsibleSection title="Индивидуальные" tasks={activeIndividual} isAdmin />
          <CollapsibleSection title="Парные и потоки" tasks={activeGroup} isAdmin />
          <CollapsibleSection title="Перекрёстные из пар" tasks={activeCross} isAdmin />
          <CollapsibleSection title="Истёк срок" tasks={overdue} isAdmin />
        </>
      ) : (
        <>
          {mine.length > 0 && (
            <section className={styles.section}>
              <h2 className={`${styles.sectionTitle} ${styles.sectionTitleActive}`}>Активные</h2>
              <div className={styles.grid}>
                {mine.map((task) => (
                  <TaskCard key={task.id} task={task} isAdmin={false} />
                ))}
              </div>
            </section>
          )}
          {mineDone.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Выполненные</h2>
              <div className={styles.grid}>
                {mineDone.map((task) => (
                  <TaskCard key={task.id} task={task} isAdmin={false} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
