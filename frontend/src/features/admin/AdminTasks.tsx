import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminTaskLibrary,
  useCreateTask,
  useDeleteTask,
  useRepublishTask,
  useUpdateTask,
  type TaskLibraryItemOut,
  type TaskType,
} from '../../api/tasks'
import { useAdminIntakes } from '../../api/admin'
import { useAdminPlans } from '../../api/plans'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Chip } from '../../components/Chip'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { Input } from '../../components/Input'
import { KebabMenu } from '../../components/KebabMenu'
import { Modal } from '../../components/Overlay'
import { PageHeader } from '../../components/PageHeader'
import { Segmented } from '../../components/Segmented'
import { Spinner } from '../../components/Spinner'
import { dateTimeMsk, dayLabel } from '../../lib/format'
import { toast } from '../../stores/toast'
import { localInputToIso, TaskForm, TYPE_LABEL, type TaskFormValues } from '../tasks/TaskForm'
import styles from './admin.module.css'

type TypeFilter = 'all' | TaskType

const TYPE_TABS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'common', label: 'Общие' },
  { value: 'individual', label: 'Индивидуальные' },
  { value: 'pair', label: 'Парные' },
  { value: 'stream', label: 'Поток' },
]

/** `YYYY-MM-DD` → «2 июня 2026». */
function intakeDate(startsOn: string): string {
  return new Date(`${startsOn}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function RepublishModal({
  task,
  onClose,
}: {
  task: TaskLibraryItemOut
  onClose: () => void
}) {
  const { data: intakes = [] } = useAdminIntakes()
  const { data: plans = [] } = useAdminPlans()
  const republish = useRepublishTask()

  const alreadyOn = new Set(task.published_intake_ids)
  const [intakeId, setIntakeId] = useState<number | ''>('')
  const [deadline, setDeadline] = useState('')
  const [publishAt, setPublishAt] = useState('')
  const [planIds, setPlanIds] = useState<number[]>(task.plan_ids)

  function togglePlan(id: number) {
    setPlanIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (intakeId === '') return
    republish.mutate(
      {
        taskId: task.id,
        intake_id: intakeId,
        deadline_at: localInputToIso(deadline),
        publish_at: localInputToIso(publishAt),
        plan_ids: planIds,
      },
      {
        onSuccess: () => {
          toast('Задача переиздана для потока')
          onClose()
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  return (
    <Modal title="Опубликовать для потока" onClose={onClose} closeOnBackdrop={false}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <p className={styles.mediaEmpty}>
          Создаст новую общую задачу «{task.title}» для выбранного потока — без сдач и
          назначений прошлого потока. Оригинал не меняется.
        </p>

        <label className={styles.label}>
          Поток
          <select
            className={styles.input}
            value={intakeId}
            onChange={(e) => setIntakeId(e.target.value ? Number(e.target.value) : '')}
            required
          >
            <option value="">— выбрать —</option>
            {intakes.map((intake) => (
              <option key={intake.id} value={intake.id} disabled={alreadyOn.has(intake.id)}>
                {intakeDate(intake.starts_on)}
                {alreadyOn.has(intake.id) ? ' — уже переиздано' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.label}>
          Дедлайн (необязательно)
          <input
            className={styles.input}
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>

        <label className={styles.label}>
          Публикация (необязательно)
          <input
            className={styles.input}
            type="datetime-local"
            value={publishAt}
            onChange={(e) => setPublishAt(e.target.value)}
          />
        </label>
        <p className={styles.mediaEmpty}>
          Не заполнено — опубликована сразу. Иначе скрыта от участников до этого момента.
        </p>

        <div className={styles.label}>
          Тарифы
          {plans.length === 0 ? (
            <p className={styles.mediaEmpty}>Тарифов пока нет</p>
          ) : (
            <div className={styles.checkRow}>
              {plans.map((plan) => (
                <label key={plan.id} className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={planIds.includes(plan.id)}
                    onChange={() => togglePlan(plan.id)}
                  />
                  {plan.name}
                </label>
              ))}
            </div>
          )}
          <p className={styles.mediaEmpty}>Ничего не выбрано — доступна всем тарифам потока</p>
        </div>

        <div className={styles.formActions}>
          <Button type="submit" disabled={intakeId === '' || republish.isPending}>
            Опубликовать
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function AdminTasks() {
  const { data: intakes = [] } = useAdminIntakes()
  const activeIntake = intakes[0]

  // null — фильтр не трогали: активный поток. 'all' — все потоки. 'cross' —
  // только кросс-потоковые (intake_id IS NULL).
  const [intakeFilter, setIntakeFilter] = useState<number | 'all' | 'cross' | null>(null)
  const selectedIntake = intakeFilter ?? activeIntake?.id ?? 'all'
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [query, setQuery] = useState('')

  const { data, isLoading } = useAdminTaskLibrary({
    intakeId: selectedIntake === 'all' ? undefined : selectedIntake === 'cross' ? 'null' : selectedIntake,
    type: typeFilter === 'all' ? undefined : typeFilter,
    q: query.trim() || undefined,
  })
  const items = useMemo(() => data?.items ?? [], [data])

  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  const [createOpen, setCreateOpen] = useState(false)
  const [createFromTask, setCreateFromTask] = useState<TaskLibraryItemOut | null>(null)
  const [editTask, setEditTask] = useState<TaskLibraryItemOut | null>(null)
  const [republishTask, setRepublishTask] = useState<TaskLibraryItemOut | null>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<number | null>(null)

  function submitCreate(values: TaskFormValues) {
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
        publish_at: values.publish_at,
        is_draft: values.is_draft,
        kb_item_id: values.kb_item_id,
        assignee_ids: values.type === 'individual' ? values.assignee_ids : undefined,
        pairs:
          values.type === 'pair'
            ? values.pairs.map(([a, b]) => ({ user_ids: [a, b] as [number, number] }))
            : undefined,
        participant_ids: values.type === 'stream' ? values.participant_ids : undefined,
        media_asset_ids: values.media.map((m) => m.id),
        playlist_id: values.playlist?.id ?? null,
        intake_id: values.type === 'common' ? values.intake_id : undefined,
        plan_ids: values.type === 'common' ? values.plan_ids : undefined,
      },
      {
        onSuccess: () => {
          toast('Создано')
          setCreateOpen(false)
          setCreateFromTask(null)
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function submitEdit(values: TaskFormValues) {
    if (!editTask) return
    updateTask.mutate(
      {
        id: editTask.id,
        title: values.title,
        body: values.body || null,
        deadline_at: values.deadline_at,
        publish_at: values.publish_at,
        is_draft: values.is_draft,
        kb_item_id: values.kb_item_id,
        media_asset_ids: values.media.map((m) => m.id),
        playlist_id: values.playlist?.id ?? null,
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

  // Быстрое «опубликовать/вернуть в черновик» из списка, без открытия формы —
  // единственное, что меняем, это флаг (PATCH применяет только переданные поля).
  function toggleDraft(item: TaskLibraryItemOut) {
    updateTask.mutate(
      { id: item.id, is_draft: !item.is_draft },
      {
        onSuccess: () => toast(item.is_draft ? 'Опубликовано' : 'Возвращено в черновик'),
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
      <PageHeader title="Задания">
        <Button onClick={() => setCreateOpen(true)}>Создать</Button>
      </PageHeader>

      <div className={styles.checkRow}>
        <select
          className={styles.input}
          value={String(selectedIntake)}
          onChange={(e) =>
            setIntakeFilter(
              e.target.value === 'all' || e.target.value === 'cross'
                ? e.target.value
                : Number(e.target.value),
            )
          }
        >
          {intakes.map((intake) => (
            <option key={intake.id} value={intake.id}>
              {intakeDate(intake.starts_on)}
              {intake.id === activeIntake?.id ? ' — активный' : ''}
            </option>
          ))}
          <option value="all">Все потоки</option>
          <option value="cross">Без потока (общие для всех)</option>
        </select>
      </div>

      <Segmented options={TYPE_TABS} value={typeFilter} onChange={setTypeFilter} label="Тип задачи" />

      <Input
        placeholder="Поиск по названию"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {isLoading ? (
        <div className="center grow"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState>Ничего не найдено</EmptyState>
      ) : (
        <div className={styles.list}>
          {items.map((item) => {
            const intake = intakes.find((i) => i.id === item.intake_id)
            const scheduled = item.publish_at != null && new Date(item.publish_at).getTime() > Date.now()
            const canRepublish = item.type === 'common' || item.type === 'individual'
            return (
              <div className={styles.listItem} key={item.id}>
                <div className={styles.listItemMain}>
                  <div>
                    <span className={styles.listTitle}>{item.title}</span>{' '}
                    <Badge tone="accent">{TYPE_LABEL[item.type]}</Badge>
                  </div>
                  <div className={styles.listMeta}>
                    {intake ? intakeDate(intake.starts_on) : 'Общая для всех потоков'} · сдали{' '}
                    {item.submitted_count} из {item.total_recipients}
                    {item.deadline_at && ` · дедлайн ${dayLabel(item.deadline_at)}`}
                  </div>
                  <div className={styles.checkRow}>
                    {item.is_draft && <Chip kind="unreviewed">Черновик</Chip>}
                    {!item.is_draft && scheduled && item.publish_at && (
                      <Chip kind="soon">Запланировано: {dateTimeMsk(item.publish_at)}</Chip>
                    )}
                    {item.published_intake_ids.length > 0 && (
                      <span className={styles.listMeta}>
                        Уже на потоках: {item.published_intake_ids.length}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.listActions}>
                  <Link to={`/tasks/${item.id}`}>
                    <Button variant="outline">Открыть</Button>
                  </Link>
                  <KebabMenu
                    ariaLabel="Действия с заданием"
                    items={[
                      ...(canRepublish
                        ? [{ key: 'republish', label: 'Опубликовать для потока…', onClick: () => setRepublishTask(item) }]
                        : [{ key: 'from', label: 'Создать на основе', onClick: () => setCreateFromTask(item) }]),
                      {
                        key: 'draft',
                        label: item.is_draft ? 'Опубликовать' : 'Вернуть в черновик',
                        onClick: () => toggleDraft(item),
                      },
                      { key: 'edit', label: 'Редактировать', onClick: () => setEditTask(item) },
                      { key: 'delete', label: 'Удалить', onClick: () => setDeleteTaskId(item.id), danger: true },
                    ]}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {createOpen && (
        <Modal title="Создать задачу" onClose={() => setCreateOpen(false)} closeOnBackdrop={false}>
          <TaskForm onSubmit={submitCreate} />
        </Modal>
      )}

      {createFromTask && (
        <Modal
          title="Создать на основе"
          onClose={() => setCreateFromTask(null)}
          closeOnBackdrop={false}
        >
          <TaskForm initial={createFromTask} createFromInitial onSubmit={submitCreate} />
        </Modal>
      )}

      {editTask && (
        <Modal title="Редактировать задачу" onClose={() => setEditTask(null)} closeOnBackdrop={false}>
          <TaskForm initial={editTask} onSubmit={submitEdit} />
        </Modal>
      )}

      {republishTask && (
        <RepublishModal task={republishTask} onClose={() => setRepublishTask(null)} />
      )}

      {deleteTaskId != null && (
        <ConfirmDialog
          title="Удалить задачу?"
          text="Задача будет скрыта из раздела «Задачи» и базы заданий. Действие можно отменить только через поддержку."
          onConfirm={handleDelete}
          onClose={() => setDeleteTaskId(null)}
        />
      )}
    </div>
  )
}

