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
import { dateTimeMsk } from '../../lib/format'
import { toast } from '../../stores/toast'
import styles from './tasks.module.css'

function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
  const [value, setValue] = useState(isoToLocalInput(pair.meeting_at))

  function save(meetingAt: string | null) {
    update.mutate(
      { pairId: pair.pair_id, meetingAt },
      {
        onSuccess: () => toast(meetingAt ? 'Встреча сохранена' : 'Встреча отменена'),
        onError: (err) => toast(errMsg(err), 'error'),
      },
    )
  }

  return (
    <div className={styles.myStatusRow}>
      <span className={styles.myStatusLabel}>Встреча:</span>
      {pair.can_manage_meeting ? (
        <>
          <input
            type="datetime-local"
            className={styles.composerInput}
            style={{ maxWidth: 220 }}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={update.isPending || !value}
            onClick={() => save(value ? new Date(value).toISOString() : null)}
          >
            Сохранить
          </Button>
          {pair.meeting_at && (
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
          )}
        </>
      ) : (
        <span>
          {pair.meeting_at ? (
            dateTimeMsk(pair.meeting_at)
          ) : partner ? (
            `Свяжитесь с ${nameOf(partner.user_id)}, чтобы назначить встречу`
          ) : (
            'Не назначена'
          )}
        </span>
      )}
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
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [media, setMedia] = useState<MediaChip[]>([])

  // Уже выдал задачу партнёру → показываем ссылку, композер не нужен.
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

  function submit() {
    if (!title.trim() || create.isPending) return
    create.mutate(
      { pairId, title: title.trim(), body: body || null, media_asset_ids: media.map((m) => m.id) },
      {
        onSuccess: () => {
          toast('Задача выдана')
          setOpen(false)
          setTitle('')
          setBody('')
          setMedia([])
        },
        onError: (err) => toast(errMsg(err), 'error'),
      },
    )
  }

  if (!open) {
    return (
      <div className={styles.reviewActions}>
        <Button type="button" onClick={() => setOpen(true)}>
          Выдать задачу партнёру
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <input
        className={styles.composerInput}
        placeholder={`Заголовок задачи для ${partnerName}…`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <MediaComposer
        value={body}
        onChange={setBody}
        attachments={media}
        onAttachmentsChange={setMedia}
        placeholder="Условие задачи (поддерживается Markdown)…"
        rows={4}
      />
      <div className={styles.reviewActions}>
        <Button type="button" onClick={submit} disabled={create.isPending || !title.trim()}>
          Выдать
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </div>
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
