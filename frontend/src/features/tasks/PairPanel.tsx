import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useCreateCrossTask,
  useUpdateCrossTask,
  useDeletePair,
  useTask,
  type PairOut,
  type PairMemberOut,
  type TaskOut,
} from '../../api/tasks'
import { useUsersMap } from '../../api/users'
import { Button } from '../../components/Button'
import { MediaComposer, type MediaChip } from '../../components/MediaComposer'
import { Modal } from '../../components/Overlay'
import { Chip } from '../../components/Chip'
import { toast } from '../../stores/toast'
import { isoToLocalInput } from './TaskForm'
import styles from './tasks.module.css'

// datetime-local → ISO (для дедлайна в форме выдачи задачи).
function localInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка'
}

/**
 * Панель парного задания. Участник видит одну свою пару: партнёра, встречу
 * (управляет организатор, иначе — «свяжитесь с …»), кнопку выдать задачу партнёру и
 * ссылку на задачу от партнёра. Админ видит все пары + скрытые действия (удалить пару).
 */
export function PairPanel({
  taskId,
  pairs,
  isAdmin,
}: {
  taskId: number
  pairs: PairOut[]
  isAdmin: boolean
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{isAdmin ? 'Пары' : 'Моя пара'}</h2>
      {pairs.length === 0 && (
        <div className={styles.emptyNote}>Пар пока нет.</div>
      )}
      {pairs.map((pair) => (
        <PairCard key={pair.pair_id} taskId={taskId} pair={pair} isAdmin={isAdmin} />
      ))}
    </section>
  )
}

function PairCard({
  taskId,
  pair,
  isAdmin,
}: {
  taskId: number
  pair: PairOut
  isAdmin: boolean
}) {
  const users = useUsersMap()
  const nameOf = (uid: number) =>
    users.get(uid)?.display_name ?? `Участник #${uid}`
  const usernameOf = (uid: number) =>
    users.get(uid)?.username ?? `id${uid}`

  const viewer = pair.viewer_user_id
  const me: PairMemberOut | undefined = viewer
    ? pair.members.find((m) => m.user_id === viewer)
    : undefined
  const partner: PairMemberOut | undefined = viewer
    ? pair.members.find((m) => m.user_id !== viewer)
    : undefined

  return (
    <div className={styles.track}>
      {/* Заголовок пары: для участника — «Партнёр: X»; для админа — «X ↔ Y». */}
      <div className={styles.trackHead}>
        <span className={styles.trackName}>
          {viewer && partner
            ? `Партнёр: ${nameOf(partner.user_id)}`
            : pair.members.map((m) => nameOf(m.user_id)).join(' ↔ ')}
        </span>
        {isAdmin && <AdminPairActions taskId={taskId} pair={pair} />}
      </div>

      <MeetingBlock pair={pair} partner={partner} usernameOf={usernameOf} />

      {/* Участник: выдать задачу партнёру / ссылка на выданную. */}
      {viewer && me && partner && (
        <GiveTaskBlock
          taskId={taskId}
          pairId={pair.pair_id}
          me={me}
          partnerName={nameOf(partner.user_id)}
        />
      )}

      {/* Задача, которую участнику выдал партнёр. */}
      {viewer && partner?.cross_task_id != null && (
        <div className={styles.myStatusRow}>
          <span className={styles.myStatusLabel}>Задача от партнёра:</span>
          <Link className={styles.kbLink} to={`/tasks/${partner.cross_task_id}`}>
            Открыть
          </Link>
        </div>
      )}

      {/* Админский обзор перекрёстных задач пары. */}
      {isAdmin && (
        <div className={styles.cardChips}>
          {pair.members.map((m) => (
            <Chip key={m.user_id}>
              {nameOf(m.user_id)}:{' '}
              {m.cross_task_id != null ? (
                <Link to={`/tasks/${m.cross_task_id}`}>задача выдана</Link>
              ) : (
                'ещё не выдал'
              )}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

function MeetingBlock({
  pair,
  partner,
  usernameOf,
}: {
  pair: PairOut
  partner: PairMemberOut | undefined
  usernameOf: (uid: number) => string
}) {
  // Назначение встречи из интерфейса убрано: участники изучают дневник и задания
  // друг друга сами. Участнику (есть partner) — от второго лица. Админу (пары,
  // где он не состоит) — от третьего лица, оба участника названы.
  if (partner) {
    return (
      <div className={styles.myStatusRow}>
        <span className={styles.myStatusLabel}>Встреча:</span>
        <span>
          Изучи дневник и задания @{usernameOf(partner.user_id)}, по
          необходимости задай вопросы в личных сообщениях.
        </span>
      </div>
    )
  }

  const names = pair.members.map((m) => `@${usernameOf(m.user_id)}`).join(' и ')

  return (
    <div className={styles.myStatusRow}>
      <span className={styles.myStatusLabel}>Встреча:</span>
      <span>
        {names} должны изучить дневник и задания друг друга, по необходимости
        задать вопросы в личных сообщениях.
      </span>
    </div>
  )
}

function GiveTaskBlock({
  taskId,
  pairId,
  me,
  partnerName,
}: {
  taskId: number
  pairId: number
  me: PairMemberOut
  partnerName: string
}) {
  const create = useCreateCrossTask(taskId)
  const update = useUpdateCrossTask(taskId)
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const crossTaskId = me.cross_task_id
  // Пока нет сдач — задачу можно поправить; данные для формы тянем только для
  // этого окна (после первой сдачи кнопка «Редактировать» пропадёт сама).
  const { data: crossTask } = useTask(
    crossTaskId != null && me.cross_task_editable ? crossTaskId : -1,
  )

  // Уже выдал задачу партнёру → ссылка на неё + правка, пока партнёр не сдал.
  if (crossTaskId != null) {
    return (
      <>
        <div className={styles.myStatusRow}>
          <span className={styles.myStatusLabel}>Ваша задача партнёру:</span>
          <Link className={styles.kbLink} to={`/tasks/${crossTaskId}`}>
            Открыть
          </Link>
          {me.cross_task_editable && (
            <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
              Редактировать
            </Button>
          )}
        </div>
        {editOpen && crossTask && (
          <Modal
            title={`Редактировать задачу для ${partnerName}`}
            onClose={() => setEditOpen(false)}
            closeOnBackdrop={false}
          >
            <GiveTaskForm
              partnerName={partnerName}
              pending={update.isPending}
              initial={crossTask}
              submitLabel="Сохранить"
              onCancel={() => setEditOpen(false)}
              onSubmit={(values) =>
                update.mutate(
                  { pairId, crossTaskId, ...values },
                  {
                    onSuccess: () => {
                      toast('Задача обновлена')
                      setEditOpen(false)
                    },
                    onError: (err) => toast(errMsg(err), 'error'),
                  },
                )
              }
            />
          </Modal>
        )}
      </>
    )
  }

  return (
    <>
      <div className={styles.reviewActions}>
        <Button type="button" onClick={() => setOpen(true)}>
          Выдать задачу партнёру
        </Button>
      </div>
      {open && (
        <Modal
          title={`Задача для ${partnerName}`}
          onClose={() => setOpen(false)}
          closeOnBackdrop={false}
        >
          <GiveTaskForm
            partnerName={partnerName}
            pending={create.isPending}
            onCancel={() => setOpen(false)}
            onSubmit={(values) =>
              create.mutate(
                { pairId, ...values },
                {
                  onSuccess: () => {
                    toast('Задача выдана')
                    setOpen(false)
                  },
                  onError: (err) => toast(errMsg(err), 'error'),
                },
              )
            }
          />
        </Modal>
      )}
    </>
  )
}

// Полноценная форма выдачи задачи партнёру (как в админке): заголовок, описание с
// MediaComposer, необязательный дедлайн.
function GiveTaskForm({
  partnerName,
  pending,
  initial,
  submitLabel = 'Выдать',
  onSubmit,
  onCancel,
}: {
  partnerName: string
  pending: boolean
  // Задано при редактировании уже выданной задачи — предзаполняет поля формы.
  initial?: Pick<TaskOut, 'title' | 'body' | 'deadline_at' | 'attachments'> | null
  submitLabel?: string
  onSubmit: (v: {
    title: string
    body: string | null
    deadline_at: string | null
    media_asset_ids: number[]
  }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [deadline, setDeadline] = useState(isoToLocalInput(initial?.deadline_at ?? null))
  const [media, setMedia] = useState<MediaChip[]>(
    () => (initial?.attachments ?? []).map((a) => ({ id: a.asset_id, kind: a.kind })),
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || pending) return
    onSubmit({
      title: title.trim(),
      body: body || null,
      deadline_at: localInputToIso(deadline),
      media_asset_ids: media.map((m) => m.id),
    })
  }

  return (
    <form onSubmit={handleSubmit} className={styles.section}>
      <label className={styles.myStatusLabel}>
        Заголовок
        <input
          className={styles.composerInput}
          placeholder={`Что отработать с ${partnerName}…`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>

      <div className={styles.myStatusLabel}>
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

      <label className={styles.myStatusLabel}>
        Дедлайн (необязательно)
        <input
          type="datetime-local"
          className={styles.composerInput}
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </label>

      <div className={styles.reviewActions}>
        <Button type="submit" disabled={pending || !title.trim()}>
          {submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  )
}

// Скрытые админские действия над парой (расформировать). Требует подтверждения.
function AdminPairActions({ taskId, pair }: { taskId: number; pair: PairOut }) {
  const del = useDeletePair(taskId)
  function remove() {
    if (!window.confirm('Расформировать пару? Выданные задачи будут скрыты.')) return
    del.mutate(pair.pair_id, {
      onSuccess: () => toast('Пара расформирована'),
      onError: (err) => toast(errMsg(err), 'error'),
    })
  }
  return (
    <button
      className={styles.commentDelete}
      type="button"
      onClick={remove}
      title="Расформировать пару"
      aria-label="Расформировать пару"
    >
      ✕
    </button>
  )
}
