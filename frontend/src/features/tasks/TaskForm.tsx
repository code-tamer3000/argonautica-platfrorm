import { useState } from 'react'
import { useKbItems } from '../../api/kb'
import { useAdminIntakes, useAdminUsers, useAdminUsersMap } from '../../api/admin'
import { useAdminPlans } from '../../api/plans'
import type { TaskType, TaskWithStatusOut } from '../../api/tasks'
import { Button } from '../../components/Button'
import { MediaComposer, type MediaChip } from '../../components/MediaComposer'
import { useUiStore } from '../../stores/ui'
// Форма создания/редактирования задачи — перенесена из features/admin/AdminTasks
// в основной раздел «Задачи» (админ-действия теперь живут там, не в «Управлении»).
// Стили намеренно остаются админскими: форма живёт в модалке, а не в общем макете страницы.
import styles from '../admin/admin.module.css'

export const TYPE_LABEL: Record<TaskType, string> = {
  common: 'Общая',
  individual: 'Индивидуальная',
  pair: 'Парная',
  stream: 'Поток',
}

/** `YYYY-MM-DD` → «2 июня 2026». Дата набора календарная, без часовых поясов. */
function intakeDate(startsOn: string): string {
  return new Date(`${startsOn}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export interface TaskFormValues {
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
  // Изоляция по потоку/тарифу (ARG-96) — применяется только к type='common'.
  intake_id: number | null
  plan_ids: number[]
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

export function TaskForm({ initial, onSubmit }: TaskFormProps) {
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
  // Изоляция общей задачи по потоку/тарифу (ARG-96) — не действует на
  // individual/pair/stream, там видимость уже держится на назначении/членстве.
  // Новая задача по умолчанию берёт «текущий поток» админа (ARG-104); при
  // редактировании — сохранённое значение как есть, даже если это null.
  const adminCurrentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const [taskIntakeId, setTaskIntakeId] = useState<number | null>(
    editing ? (initial?.intake_id ?? null) : adminCurrentIntakeId,
  )
  const [taskPlanIds, setTaskPlanIds] = useState<number[]>(initial?.plan_ids ?? [])
  const { data: plans = [] } = useAdminPlans()

  const { data: kbItems = [] } = useKbItems()

  // Получателей берём из admin-ручки: она умеет фильтровать по набору. Публичный
  // /api/users здесь не годится — он без фильтров и нужен другим фичам как есть.
  const { data: intakes = [] } = useAdminIntakes()
  // Наборы приходят свежими сверху: активный — тот, что стартует последним.
  const activeIntake = intakes[0]
  // null — фильтр не трогали: по умолчанию только активный набор. 'all' — все наборы.
  const [intakeFilter, setIntakeFilter] = useState<number | 'all' | null>(null)
  const selectedIntake: number | 'all' = intakeFilter ?? activeIntake?.id ?? 'all'
  const { data: users = [] } = useAdminUsers(
    selectedIntake === 'all' ? undefined : selectedIntake,
  )
  // Имена резолвим по всем наборам: уже выбранный человек не должен превратиться
  // в «#12», если фильтр переключили на другой набор.
  const allUsers = useAdminUsersMap()
  const participants = users.filter((u) => u.role !== 'admin')

  // Пары: в них могут участвовать и админы, поэтому к отфильтрованному по набору
  // списку добавляем админов — у них intake_id пустой, и фильтр выкинул бы их совсем.
  // Уже занятых в паре не предлагаем (один человек — максимум в одной паре задания).
  const pairCandidates = [
    ...users,
    ...[...allUsers.values()].filter((u) => u.role === 'admin' && !users.some((x) => x.id === u.id)),
  ]
  const takenInPairs = new Set(pairs.flat())
  const nameOf = (uid: number) =>
    allUsers.get(uid)?.display_name ?? users.find((u) => u.id === uid)?.display_name ?? `#${uid}`

  // Выбранные вне текущего фильтра — их чекбоксов на экране нет, поэтому показываем
  // счётчиком, чтобы «выбрал → переключил набор → потерял» не выглядело как пропажа.
  const hiddenSelected = (ids: number[]) => ids.filter((id) => !users.some((u) => u.id === id))

  const needsPeople = !editing && (type === 'individual' || type === 'pair' || type === 'stream')
  const intakeFilterRow = needsPeople && intakes.length > 0 && (
    <div className={styles.formRow}>
      <label htmlFor="task_intake_filter">Набор получателей</label>
      <select
        id="task_intake_filter"
        className={styles.input}
        value={String(selectedIntake)}
        onChange={(e) =>
          setIntakeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
        }
      >
        {intakes.map((intake) => (
          <option key={intake.id} value={intake.id}>
            {intakeDate(intake.starts_on)}
            {intake.id === activeIntake?.id ? ' — активный' : ''} ({intake.user_count})
          </option>
        ))}
        <option value="all">Все наборы</option>
      </select>
    </div>
  )

  function toggleStreamer(id: number) {
    setStreamers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleAssignee(id: number) {
    setAssignees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleTaskPlan(id: number) {
    setTaskPlanIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
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
      intake_id: taskIntakeId,
      plan_ids: taskPlanIds,
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

      {type === 'common' && (
        <>
          <label className={styles.label}>
            Изоляция: набор
            <select
              className={styles.input}
              value={taskIntakeId ?? ''}
              onChange={(e) => setTaskIntakeId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Общая для всех потоков</option>
              {intakes.map((intake) => (
                <option key={intake.id} value={intake.id}>
                  {intake.starts_on} – {intake.ends_on}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.label}>
            Изоляция: тарифы
            {plans.length === 0 ? (
              <p className={styles.mediaEmpty}>Тарифов пока нет</p>
            ) : (
              <div className={styles.checkRow}>
                {plans.map((plan) => (
                  <label key={plan.id} className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={taskPlanIds.includes(plan.id)}
                      onChange={() => toggleTaskPlan(plan.id)}
                    />
                    {plan.name}
                  </label>
                ))}
              </div>
            )}
            <p className={styles.mediaEmpty}>Ничего не выбрано — доступна всем тарифам потока</p>
          </div>
        </>
      )}

      {intakeFilterRow}

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
            {participants.length === 0 && (
              <p className={styles.mediaEmpty}>В этом наборе нет участников</p>
            )}
          </div>
          {hiddenSelected(assignees).length > 0 && (
            <p className={styles.mediaEmpty}>
              Ещё выбрано из других наборов: {hiddenSelected(assignees).map(nameOf).join(', ')}
            </p>
          )}
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
            {hiddenSelected(streamers).length > 0 &&
              ` Из других наборов: ${hiddenSelected(streamers).map(nameOf).join(', ')}.`}
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
              {pairCandidates
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
              {pairCandidates
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
