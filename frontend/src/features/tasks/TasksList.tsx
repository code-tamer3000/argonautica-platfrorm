import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminAssignments,
  useCreateTask,
  useDeleteTask,
  useTasks,
  useUpdateTask,
  type MyTaskStatus,
  type TaskWithStatusOut,
} from '../../api/tasks'
import { useAdminPlans } from '../../api/plans'
import { useUsersMap } from '../../api/users'
import { useAuth } from '../auth/AuthContext'
import { BackButton } from '../../components/BackButton'
import ph from '../../components/pageHeader.module.css'
import { Spinner } from '../../components/Spinner'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Chip, type ChipKind } from '../../components/Chip'
import { cardClass } from '../../components/Card'
import { Segmented } from '../../components/Segmented'
import { KebabMenu } from '../../components/KebabMenu'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Modal } from '../../components/Overlay'
import { toast } from '../../stores/toast'
import { dayLabel } from '../../lib/format'
import { useUiStore } from '../../stores/ui'
import { TaskForm, TYPE_LABEL, type TaskFormValues } from './TaskForm'
import styles from './tasks.module.css'

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

function TaskCard({
  task,
  isAdmin,
  onEdit,
  onDelete,
}: {
  task: TaskWithStatusOut
  isAdmin: boolean
  onEdit?: () => void
  onDelete?: () => void
}) {
  return (
    <Link to={`/tasks/${task.id}`} className={cardClass({ interactive: true })}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{task.title}</span>
        <Badge tone="accent">{TYPE_LABEL[task.type]}</Badge>
        {isAdmin && onEdit && onDelete && (
          <KebabMenu
            ariaLabel="Действия с задачей"
            items={[
              { key: 'edit', label: 'Редактировать', onClick: onEdit },
              { key: 'delete', label: 'Удалить', onClick: onDelete, danger: true },
            ]}
          />
        )}
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

type DeadlineTab = 'active' | 'overdue'
type TypeTab = 'common' | 'individual' | 'group' | 'cross'

const DEADLINE_TABS = [
  { value: 'active' as const, label: 'Активные' },
  { value: 'overdue' as const, label: 'Истёк срок' },
]

const TYPE_TABS = [
  { value: 'common' as const, label: 'Общие' },
  { value: 'individual' as const, label: 'Индивидуальные' },
  { value: 'group' as const, label: 'Парные и потоки' },
  { value: 'cross' as const, label: 'Перекрёстные' },
]

export function TasksList() {
  const { data, isLoading } = useTasks()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // «Текущая экспедиция» (ARG-104): для admin этот экран не гейтится сервером
  // вообще (полный доступ) — сужаем отображение тем же общим контекстом, что и
  // раньше был у /admin/tasks. Индивидуальные/парные/потоковые задачи всегда
  // intake_id=NULL (видимость на назначении, не потоке) — фильтр их не трогает.
  // Выбирается ОДИН раз в /admin/expeditions, здесь только читаем.
  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const intakeFiltered = isAdmin && currentIntakeId != null

  const allItems = data?.items ?? []
  const items = intakeFiltered
    ? allItems.filter((t) => t.intake_id == null || t.intake_id === currentIntakeId)
    : allItems

  // Участник — по своему статусу: активные vs выполненные (принятые).
  const mine = items.filter((t) => t.my_status !== 'accepted')
  const mineDone = items.filter((t) => t.my_status === 'accepted')

  // Админ: два уровня вкладок — Активные/Истёк срок, внутри — Общие/Индивидуальные/
  // Парные и потоки/Перекрёстные.
  const [deadlineTab, setDeadlineTab] = useState<DeadlineTab>('active')
  const [typeTab, setTypeTab] = useState<TypeTab>('common')

  const deadlineItems = items.filter((t) => (deadlineTab === 'active' ? !isOverdue(t) : isOverdue(t)))
  // Перекрёстные проверяем первыми — pair_id != null может стоять и на «обычной»
  // задаче типа pair (сама задача пары), поэтому перекрёстность решает не type.
  const crossItems = deadlineItems.filter((t) => t.pair_id != null)
  const mainItems = deadlineItems.filter((t) => t.pair_id == null)
  const commonItems = mainItems.filter((t) => t.type === 'common')
  const individualItems = mainItems.filter((t) => t.type === 'individual')
  const groupItems = mainItems.filter((t) => t.type === 'pair' || t.type === 'stream')

  // Фильтр общих задач по тарифам (только вкладка «Общие»). Все тарифы отмечены
  // по умолчанию; задача без ограничений (plan_ids пуст) видна всегда.
  const { data: plans = [] } = useAdminPlans()
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<number> | null>(null)
  useEffect(() => {
    if (selectedPlanIds == null && plans.length > 0) {
      setSelectedPlanIds(new Set(plans.map((p) => p.id)))
    }
  }, [plans, selectedPlanIds])

  function togglePlanFilter(id: number) {
    setSelectedPlanIds((prev) => {
      const next = new Set(prev ?? plans.map((p) => p.id))
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const commonItemsFiltered =
    typeTab === 'common' && selectedPlanIds != null
      ? commonItems.filter(
          (t) => t.plan_ids.length === 0 || t.plan_ids.some((id) => selectedPlanIds.has(id)),
        )
      : commonItems

  const tabItems: Record<TypeTab, TaskWithStatusOut[]> = {
    common: commonItemsFiltered,
    individual: individualItems,
    group: groupItems,
    cross: crossItems,
  }
  const visibleItems = tabItems[typeTab]

  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const [createOpen, setCreateOpen] = useState(false)
  const [editTask, setEditTask] = useState<TaskWithStatusOut | null>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<number | null>(null)

  function handleCreate(values: TaskFormValues) {
    if (values.type === 'pair' && values.pairs.length === 0) {
      toast('Добавьте хотя бы одну пару', 'error')
      return
    }
    if (values.type === 'stream' && values.participant_ids.length < 2) {
      toast('В потоке должно быть минимум два участника', 'error')
      return
    }
    createTask.mutate(
      {
        type: values.type,
        title: values.title,
        body: values.body || null,
        deadline_at: values.deadline_at,
        kb_item_id: values.kb_item_id,
        assignee_ids: values.type === 'individual' ? values.assignee_ids : undefined,
        pairs:
          values.type === 'pair'
            ? values.pairs.map(([a, b]) => ({ user_ids: [a, b] as [number, number] }))
            : undefined,
        participant_ids: values.type === 'stream' ? values.participant_ids : undefined,
        media_asset_ids: values.media.map((m) => m.id),
        intake_id: values.type === 'common' ? values.intake_id : undefined,
        plan_ids: values.type === 'common' ? values.plan_ids : undefined,
      },
      {
        onSuccess: () => {
          toast('Создано')
          setCreateOpen(false)
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleEdit(values: TaskFormValues) {
    if (!editTask) return
    updateTask.mutate(
      {
        id: editTask.id,
        title: values.title,
        body: values.body || null,
        deadline_at: values.deadline_at,
        kb_item_id: values.kb_item_id,
        media_asset_ids: values.media.map((m) => m.id),
        intake_id: editTask.type === 'common' ? values.intake_id : undefined,
        plan_ids: editTask.type === 'common' ? values.plan_ids : undefined,
      },
      {
        onSuccess: () => {
          toast('Сохранено')
          setEditTask(null)
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleDelete() {
    if (deleteTaskId == null) return
    deleteTask.mutate(deleteTaskId, {
      onSuccess: () => {
        toast('Удалено')
        setDeleteTaskId(null)
      },
      onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <div className={styles.page}>
      <div className={ph.pageHeader}>
        <div className={`${ph.titleRow} ${styles.titleRow}`}>
          <BackButton />
          <h1 className={styles.pageTitle}>Задачи</h1>
        </div>
        {isAdmin && (
          <div className={ph.pageHeaderActions}>
            <Button onClick={() => setCreateOpen(true)}>Создать</Button>
          </div>
        )}
      </div>

      {isLoading && <div className="center" style={{ padding: 40 }}><Spinner /></div>}
      {!isLoading && allItems.length === 0 && (
        <div className="center muted" style={{ padding: 40 }}>Задач пока нет</div>
      )}
      {!isLoading && allItems.length > 0 && items.length === 0 && (
        <div className="center muted" style={{ padding: 40 }}>В этом потоке задач нет</div>
      )}

      {isAdmin ? (
        items.length > 0 && (
          <>
            <Segmented
              className={styles.tabsRow}
              options={DEADLINE_TABS}
              value={deadlineTab}
              onChange={setDeadlineTab}
              label="Срок"
            />
            <Segmented
              className={styles.tabsRow}
              options={TYPE_TABS.map((t) => ({ ...t, label: `${t.label} (${tabItems[t.value].length})` }))}
              value={typeTab}
              onChange={setTypeTab}
              label="Тип задачи"
            />

            {typeTab === 'common' && plans.length > 0 && (
              <div className={styles.planFilterRow}>
                <span className={styles.planFilterLabel}>Тарифы:</span>
                {plans.map((plan) => (
                  <label key={plan.id} className={styles.planFilterChip}>
                    <input
                      type="checkbox"
                      checked={selectedPlanIds?.has(plan.id) ?? true}
                      onChange={() => togglePlanFilter(plan.id)}
                    />
                    {plan.name}
                  </label>
                ))}
              </div>
            )}

            {visibleItems.length === 0 ? (
              <div className="center muted" style={{ padding: 40 }}>Здесь пусто</div>
            ) : (
              <div className={styles.grid}>
                {visibleItems.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isAdmin
                    onEdit={() => setEditTask(task)}
                    onDelete={() => setDeleteTaskId(task.id)}
                  />
                ))}
              </div>
            )}
          </>
        )
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

      {createOpen && (
        <Modal title="Создать задачу" onClose={() => setCreateOpen(false)} closeOnBackdrop={false}>
          <TaskForm onSubmit={handleCreate} />
        </Modal>
      )}

      {editTask && (
        <Modal title="Редактировать задачу" onClose={() => setEditTask(null)} closeOnBackdrop={false}>
          <TaskForm initial={editTask} onSubmit={handleEdit} />
        </Modal>
      )}

      {deleteTaskId != null && (
        <ConfirmDialog
          title="Удалить задачу?"
          text="Действие необратимо."
          onConfirm={handleDelete}
          onClose={() => setDeleteTaskId(null)}
        />
      )}
    </div>
  )
}
