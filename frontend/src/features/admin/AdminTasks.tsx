import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminAssignments,
  useCreateTask,
  useDeleteTask,
  useTasks,
  useUpdateTask,
  type TaskType,
  type TaskWithStatusOut,
} from '../../api/tasks'
import { useKbItems } from '../../api/kb'
import { useUsers, useUsersMap } from '../../api/users'
import { Button } from '../../components/Button'
import { MediaComposer, type MediaChip } from '../../components/MediaComposer'
import { Modal } from '../../components/Overlay'
import { toast } from '../../stores/toast'
import styles from './admin.module.css'

const TYPE_LABEL: Record<TaskType, string> = {
  common: 'Общая',
  individual: 'Индивидуальная',
  pair: 'Парная',
  stream: 'Поток',
}

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Назначена',
  submitted: 'На проверке',
  returned: 'Возвращена',
  accepted: 'Принята',
}

interface TaskFormValues {
  type: TaskType
  title: string
  body: string
  deadline_at: string | null
  kb_item_id: number | null
  assignee_ids: number[]
  // Пары для type='pair': каждая — [userA, userB]. Организатор встречи выбирается сервером.
  pairs: [number, number][]
  // Участники type='stream': сетку по ним строит сервер (build_bracket).
  participant_ids: number[]
  media: MediaChip[]
}

// datetime-local ↔ ISO. Значение инпута — локальное время без зоны; для бэкенда
// отдаём ISO. При редактировании ISO приводим к строке для инпута (без секунд/зоны).
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToIso(value: string): string | null {
  if (!value) return null
  return new Date(value).toISOString()
}

interface TaskFormProps {
  initial?: TaskWithStatusOut
  onSubmit: (values: TaskFormValues) => void
}

function TaskForm({ initial, onSubmit }: TaskFormProps) {
  const editing = !!initial
  const [type, setType] = useState<TaskType>(initial?.type ?? 'common')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [deadline, setDeadline] = useState(isoToLocalInput(initial?.deadline_at ?? null))
  const [kbItemId, setKbItemId] = useState<number | null>(initial?.kb_item_id ?? null)
  const [assignees, setAssignees] = useState<number[]>([])
  // Пары для парного задания. Черновик текущей собираемой пары — [a, b].
  const [pairs, setPairs] = useState<[number, number][]>([])
  // Участники потока — сетку (пары → четвёрки → …) собирает сервер.
  const [streamers, setStreamers] = useState<number[]>([])
  const [draftA, setDraftA] = useState<number | ''>('')
  const [draftB, setDraftB] = useState<number | ''>('')
  // При редактировании инициализируем вложения из existing attachments.
  const [media, setMedia] = useState<MediaChip[]>(
    () => (initial?.attachments ?? []).map((a) => ({ id: a.asset_id, kind: a.kind }))
  )

  const { data: kbItems = [] } = useKbItems()
  const { data: users = [] } = useUsers()
  const participants = users.filter((u) => u.role !== 'admin')

  // Пары: в них могут участвовать и админы, поэтому берём всех. Уже занятых в паре
  // не предлагаем (один человек — максимум в одной паре задания).
  const takenInPairs = new Set(pairs.flat())
  const nameOf = (uid: number) => users.find((u) => u.id === uid)?.display_name ?? `#${uid}`

  function toggleStreamer(id: number) {
    setStreamers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleAssignee(id: number) {
    setAssignees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function addPair() {
    if (draftA === '' || draftB === '' || draftA === draftB) return
    setPairs((prev) => [...prev, [draftA, draftB]])
    setDraftA('')
    setDraftB('')
  }

  function removePair(idx: number) {
    setPairs((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      type,
      title,
      body,
      deadline_at: localInputToIso(deadline),
      kb_item_id: kbItemId,
      assignee_ids: assignees,
      pairs,
      participant_ids: streamers,
      media,
    })
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {!editing && (
        <div className={styles.formRow}>
          <label>Тип</label>
          <div className={styles.checkRow}>
            <label className={styles.checkLabel}>
              <input
                type="radio"
                name="task-type"
                checked={type === 'common'}
                onChange={() => setType('common')}
              />
              Общая
            </label>
            <label className={styles.checkLabel}>
              <input
                type="radio"
                name="task-type"
                checked={type === 'individual'}
                onChange={() => setType('individual')}
              />
              Индивидуальная
            </label>
            <label className={styles.checkLabel}>
              <input
                type="radio"
                name="task-type"
                checked={type === 'pair'}
                onChange={() => setType('pair')}
              />
              Парная (взаимное обучение)
            </label>
            <label className={styles.checkLabel}>
              <input
                type="radio"
                name="task-type"
                checked={type === 'stream'}
                onChange={() => setType('stream')}
              />
              Поток (турнирная сетка)
            </label>
          </div>
        </div>
      )}

      <label className={styles.label}>
        Заголовок
        <input
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>

      <div className={styles.label}>
        Описание
        <MediaComposer
          value={body}
          onChange={setBody}
          attachments={media}
          onAttachmentsChange={setMedia}
          placeholder="Условие задачи (поддерживается Markdown)…"
          rows={6}
        />
      </div>

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
        Материал в базе знаний (необязательно)
        <select
          className={styles.input}
          value={kbItemId ?? ''}
          onChange={(e) => setKbItemId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— нет —</option>
          {kbItems.map((item) => (
            <option key={item.id} value={item.id}>{item.title}</option>
          ))}
        </select>
      </label>

      {!editing && type === 'individual' && (
        <div className={styles.formRow}>
          <label>Кому назначить</label>
          <div className={styles.mediaList}>
            {participants.map((u) => (
              <label key={u.id} className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={assignees.includes(u.id)}
                  onChange={() => toggleAssignee(u.id)}
                />
                {u.display_name}
              </label>
            ))}
            {participants.length === 0 && <p className={styles.mediaEmpty}>Нет участников</p>}
          </div>
        </div>
      )}

      {!editing && type === 'stream' && (
        <div className={styles.formRow}>
          <label>Участники потока</label>
          <div className={styles.mediaList}>
            {users.map((u) => (
              <label key={u.id} className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={streamers.includes(u.id)}
                  onChange={() => toggleStreamer(u.id)}
                />
                {u.display_name}
              </label>
            ))}
          </div>
          <p className={styles.mediaEmpty}>
            Выбрано: {streamers.length}. Сетку (пары → четвёрки → …) построит сервер.
          </p>
        </div>
      )}

      {!editing && type === 'pair' && (
        <div className={styles.formRow}>
          <label>Пары</label>
          <div className={styles.list}>
            {pairs.map((p, idx) => (
              <div className={styles.listItem} key={idx}>
                <div className={styles.listItemMain}>
                  <span className={styles.listTitle}>
                    {nameOf(p[0])} ↔ {nameOf(p[1])}
                  </span>
                </div>
                <div className={styles.listActions}>
                  <Button type="button" variant="outline" onClick={() => removePair(idx)}>
                    Убрать
                  </Button>
                </div>
              </div>
            ))}
            {pairs.length === 0 && <p className={styles.mediaEmpty}>Пар пока нет</p>}
          </div>
          <div className={styles.checkRow}>
            <select
              className={styles.input}
              value={draftA}
              onChange={(e) => setDraftA(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— участник —</option>
              {users
                .filter((u) => !takenInPairs.has(u.id) && u.id !== draftB)
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name}</option>
                ))}
            </select>
            <select
              className={styles.input}
              value={draftB}
              onChange={(e) => setDraftB(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— партнёр —</option>
              {users
                .filter((u) => !takenInPairs.has(u.id) && u.id !== draftA)
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name}</option>
                ))}
            </select>
            <Button
              type="button"
              variant="outline"
              onClick={addPair}
              disabled={draftA === '' || draftB === '' || draftA === draftB}
            >
              Добавить пару
            </Button>
          </div>
        </div>
      )}

      <div className={styles.formActions}>
        <Button type="submit">Сохранить</Button>
      </div>
    </form>
  )
}

function ProgressPanel({ taskId }: { taskId: number }) {
  const { data: assignments = [] } = useAdminAssignments(taskId)
  const { data: users = [] } = useUsers()
  const nameOf = (uid: number) => users.find((u) => u.id === uid)?.display_name ?? `Участник #${uid}`

  if (assignments.length === 0) {
    return <p className={styles.mediaEmpty}>Нет назначений</p>
  }
  return (
    <div className={styles.list}>
      {assignments.map((a) => (
        <div className={styles.listItem} key={a.assignment_id}>
          <div className={styles.listItemMain}>
            <span className={styles.listTitle}>{nameOf(a.user_id)}</span>
            <span className={styles.badgeDraft}>{STATUS_LABEL[a.status] ?? a.status}</span>
            {a.late && <span className={styles.badgeDraft}>сдано позже</span>}
            <span className={styles.listMeta}>сдач: {a.submission_count}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// Строка задачи в админском списке. Для individual показывает адресатов прямо в
// строке, чтобы админ сразу видел, кому выдана задача (иначе «выдал, а нигде нет»).
function TaskRow({
  task,
  onOpenProgress,
  onEdit,
  onDelete,
}: {
  task: TaskWithStatusOut
  onOpenProgress: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className={styles.taskItem}>
      <div className={styles.taskItemRow}>
        <div className={styles.listItemMain}>
          <span className={styles.listTitle}>{task.title}</span>
          <span className={styles.badgeDraft}>{TYPE_LABEL[task.type]}</span>
          <span className={styles.listMeta}>
            сдано {task.submitted_count} · принято {task.accepted_count}
            {task.assignee_count != null ? ` из ${task.assignee_count}` : ''}
          </span>
        </div>
        <div className={styles.listActions}>
          <Link to={`/tasks/${task.id}`}>
            <Button variant="outline">Открыть</Button>
          </Link>
          <Button variant="outline" onClick={onOpenProgress}>
            Прогресс
          </Button>
          <Button variant="outline" onClick={onEdit}>Редактировать</Button>
          <Button variant="outline" onClick={onDelete}>Удалить</Button>
        </div>
      </div>
      {task.type === 'individual' && <AssigneeLine taskId={task.id} />}
    </div>
  )
}

// Список адресатов индивидуальной задачи (кому назначена). Тянет назначения задачи
// и резолвит имена; пустой набор подсвечиваем как явную ошибку выдачи.
function AssigneeLine({ taskId }: { taskId: number }) {
  const { data: assignments = [], isLoading } = useAdminAssignments(taskId)
  const users = useUsersMap()

  if (isLoading) return null
  if (assignments.length === 0) {
    return (
      <div className={styles.assigneeLine}>
        <span className={styles.assigneeLineLabel}>Назначено:</span>
        <span className={styles.assigneeEmpty}>никому</span>
      </div>
    )
  }
  return (
    <div className={styles.assigneeLine}>
      <span className={styles.assigneeLineLabel}>Назначено:</span>
      {assignments.map((a) => (
        <span key={a.assignment_id} className={styles.assigneeChip}>
          {users.get(a.user_id)?.display_name ?? `Участник #${a.user_id}`}
        </span>
      ))}
    </div>
  )
}

// Истёкшая = есть дедлайн в прошлом. Без дедлайна или дедлайн в будущем — активна.
function isOverdue(task: TaskWithStatusOut): boolean {
  return task.deadline_at != null && new Date(task.deadline_at).getTime() < Date.now()
}

export function AdminTasks() {
  const { data } = useTasks()
  const items = data?.items ?? []
  // Перекрёстные задачи из пар (pair_id != null) выносим в отдельный сворачиваемый
  // раздел — иначе они засоряют общий список (по 2 на каждую пару).
  const crossTasks = items.filter((t) => t.pair_id != null)
  const mainTasks = items.filter((t) => t.pair_id == null)
  const active = mainTasks.filter((t) => !isOverdue(t))
  const overdue = mainTasks.filter(isOverdue)
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  const [createOpen, setCreateOpen] = useState(false)
  const [editTask, setEditTask] = useState<TaskWithStatusOut | null>(null)
  const [progressFor, setProgressFor] = useState<TaskWithStatusOut | null>(null)
  const [crossOpen, setCrossOpen] = useState(false)

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
        participant_ids:
          values.type === 'stream' ? values.participant_ids : undefined,
        media_asset_ids: values.media.map((m) => m.id),
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

  function handleDelete(id: number) {
    if (!window.confirm('Удалить задачу?')) return
    deleteTask.mutate(id, {
      onSuccess: () => toast('Удалено'),
      onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Задачи</h1>
        <Button onClick={() => setCreateOpen(true)}>Создать</Button>
      </div>

      {items.length === 0 && <p className={styles.mediaEmpty}>Задач пока нет</p>}

      {active.length > 0 && (
        <>
          <h2 className={styles.sectionTitle}>Активные</h2>
          <div className={styles.list}>
            {active.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onOpenProgress={() => setProgressFor(progressFor?.id === task.id ? null : task)}
                onEdit={() => setEditTask(task)}
                onDelete={() => handleDelete(task.id)}
              />
            ))}
          </div>
        </>
      )}

      {overdue.length > 0 && (
        <>
          <h2 className={styles.sectionTitle}>Истёк срок</h2>
          <div className={styles.list}>
            {overdue.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onOpenProgress={() => setProgressFor(progressFor?.id === task.id ? null : task)}
                onEdit={() => setEditTask(task)}
                onDelete={() => handleDelete(task.id)}
              />
            ))}
          </div>
        </>
      )}

      {crossTasks.length > 0 && (
        <>
          <button
            type="button"
            className={styles.sectionToggle}
            onClick={() => setCrossOpen((v) => !v)}
          >
            {crossOpen ? '▾' : '▸'} Перекрёстные задачи из пар ({crossTasks.length})
          </button>
          {crossOpen && (
            <div className={styles.list}>
              {crossTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onOpenProgress={() => setProgressFor(progressFor?.id === task.id ? null : task)}
                  onEdit={() => setEditTask(task)}
                  onDelete={() => handleDelete(task.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {progressFor && (
        <Modal title={`Прогресс: ${progressFor.title}`} onClose={() => setProgressFor(null)}>
          <ProgressPanel taskId={progressFor.id} />
        </Modal>
      )}

      {createOpen && (
        <Modal
          title="Создать задачу"
          onClose={() => setCreateOpen(false)}
          closeOnBackdrop={false}
        >
          <TaskForm onSubmit={handleCreate} />
        </Modal>
      )}

      {editTask && (
        <Modal title="Редактировать задачу" onClose={() => setEditTask(null)}>
          <TaskForm initial={editTask} onSubmit={handleEdit} />
        </Modal>
      )}
    </div>
  )
}
