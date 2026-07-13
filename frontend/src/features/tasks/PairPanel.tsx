import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useCreateCrossTask,
  useDeletePair,
  useUpdateMeeting,
  type PairOut,
  type PairMemberOut,
} from '../../api/tasks'
import { useUsersMap } from '../../api/users'
import { Button } from '../../components/Button'
import { MediaComposer, type MediaChip } from '../../components/MediaComposer'
import { Modal } from '../../components/Overlay'
import { dateTimeMsk } from '../../lib/format'
import { toast } from '../../stores/toast'
import styles from './tasks.module.css'

// datetime-local ↔ ISO (как в админской форме задач).
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
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

      <MeetingBlock taskId={taskId} pair={pair} partner={partner} nameOf={nameOf} />

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
            <span key={m.user_id} className={styles.chip}>
              {nameOf(m.user_id)}:{' '}
              {m.cross_task_id != null ? (
                <Link to={`/tasks/${m.cross_task_id}`}>задача выдана</Link>
              ) : (
                'ещё не выдал'
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function MeetingBlock({
  taskId,
  pair,
  partner,
  nameOf,
}: {
  taskId: number
  pair: PairOut
  partner: PairMemberOut | undefined
  nameOf: (uid: number) => string
}) {
  const update = useUpdateMeeting(taskId)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(isoToLocalInput(pair.meeting_at))
  const partnerName = partner ? nameOf(partner.user_id) : 'партнёром'

  function save(meetingAt: string | null) {
    update.mutate(
      { pairId: pair.pair_id, meetingAt },
      {
        onSuccess: () => {
          toast(meetingAt ? 'Встреча назначена' : 'Встреча отменена')
          setEditing(false)
        },
        onError: (err) => toast(errMsg(err), 'error'),
      },
    )
  }

  // Второй участник (не организатор) — только видит.
  if (!pair.can_manage_meeting) {
    return (
      <div className={styles.myStatusRow}>
        <span className={styles.myStatusLabel}>Встреча:</span>
        <span>
          {pair.meeting_at
            ? dateTimeMsk(pair.meeting_at)
            : `Свяжитесь с ${partnerName}, чтобы назначить встречу`}
        </span>
      </div>
    )
  }

  // Организатор, режим редактирования (выбор даты).
  if (editing) {
    return (
      <div className={styles.myStatusRow}>
        <span className={styles.myStatusLabel}>Встреча:</span>
        <input
          type="datetime-local"
          className={styles.composerInput}
          style={{ maxWidth: 220 }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          type="button"
          disabled={update.isPending || !value}
          onClick={() => save(localInputToIso(value))}
        >
          Сохранить
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={update.isPending}
          onClick={() => {
            setValue(isoToLocalInput(pair.meeting_at))
            setEditing(false)
          }}
        >
          Отмена
        </Button>
      </div>
    )
  }

  // Организатор, встреча уже назначена — дата + перенести/отменить.
  if (pair.meeting_at) {
    return (
      <div className={styles.myStatusRow}>
        <span className={styles.myStatusLabel}>Встреча с {partnerName}:</span>
        <span>{dateTimeMsk(pair.meeting_at)}</span>
        <Button type="button" variant="outline" onClick={() => setEditing(true)}>
          Перенести
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={update.isPending}
          onClick={() => {
            setValue('')
            save(null)
          }}
        >
          Отменить
        </Button>
      </div>
    )
  }

  // Организатор, встреча не назначена — кнопка с подписью.
  return (
    <div className={styles.myStatusRow}>
      <span className={styles.myStatusLabel}>Встреча:</span>
      <Button type="button" onClick={() => setEditing(true)}>
        Назначить встречу с {partnerName}
      </Button>
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
  const [open, setOpen] = useState(false)

  // Уже выдал задачу партнёру → показываем ссылку, форма не нужна.
  if (me.cross_task_id != null) {
    return (
      <div className={styles.myStatusRow}>
        <span className={styles.myStatusLabel}>Ваша задача партнёру:</span>
        <Link className={styles.kbLink} to={`/tasks/${me.cross_task_id}`}>
          Открыть
        </Link>
      </div>
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
        <Modal title={`Задача для ${partnerName}`} onClose={() => setOpen(false)}>
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
  onSubmit,
  onCancel,
}: {
  partnerName: string
  pending: boolean
  onSubmit: (v: {
    title: string
    body: string | null
    deadline_at: string | null
    media_asset_ids: number[]
  }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [deadline, setDeadline] = useState('')
  const [media, setMedia] = useState<MediaChip[]>([])

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
          Выдать
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
