import { useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  useAdminAssignments,
  useCreateSubmissionComment,
  useDeleteTaskComment,
  useReview,
  useSubmissionComments,
  useTask,
  useTaskSubmissions,
  useUpdateAssignmentDeadline,
  type AdminAssignmentOut,
  type SubmissionOut,
  type TaskTrackOut,
  type TaskType,
} from '../../api/tasks'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { IconBook, IconSend } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { Badge } from '../../components/Badge'
import { Chip, type ChipKind } from '../../components/Chip'
import { PageHeader } from '../../components/PageHeader'
import { dateTimeMsk } from '../../lib/format'
import { toast } from '../../stores/toast'
import { useAuth } from '../auth/AuthContext'
import { Attachment } from '../chat/Attachment'
import { PairPanel } from './PairPanel'
import { StreamPanel } from './stream/StreamPanel'
import { TaskComposer } from './TaskComposer'
import { isoToLocalInput, localInputToIso } from './TaskForm'
import styles from './tasks.module.css'

const ROSTER_STATUS_LABEL: Record<string, string> = {
  assigned: 'Назначена',
  submitted: 'На проверке',
  returned: 'Возвращена',
  accepted: 'Принята',
}

// Полный ростер видящих общую задачу (не только тех, у кого уже есть строка
// назначения) + продление срока одному конкретному участнику (ARG-133).
function RosterSection({ taskId }: { taskId: number }) {
  const { data: rows = [], isLoading } = useAdminAssignments(taskId)
  const updateDeadline = useUpdateAssignmentDeadline(taskId)
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  if (isLoading) return null
  if (rows.length === 0) return null

  function startEdit(row: AdminAssignmentOut) {
    setEditingUserId(row.user_id)
    setDraft(isoToLocalInput(row.deadline_at))
  }

  function save(userId: number) {
    updateDeadline.mutate(
      { userId, deadlineAt: localInputToIso(draft) },
      {
        onSuccess: () => {
          toast('Срок обновлён')
          setEditingUserId(null)
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function resetToTaskDeadline(userId: number) {
    updateDeadline.mutate(
      { userId, deadlineAt: null },
      {
        onSuccess: () => toast('Срок сброшен к общему'),
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Участники ({rows.length})</h3>
      <div className={styles.rosterList}>
        {rows.map((row) => (
          <div key={row.user_id} className={styles.rosterRow}>
            <Avatar url={row.avatar_url} name={row.display_name} size={28} />
            <span className={styles.rosterName}>{row.display_name}</span>
            <Chip kind={row.status === 'accepted' ? 'accepted' : row.status === 'returned' ? 'returned' : 'neutral'}>
              {row.status ? ROSTER_STATUS_LABEL[row.status] ?? row.status : 'Не сдавал'}
            </Chip>
            {row.late && <Chip kind="late">Сдано позже</Chip>}
            {editingUserId === row.user_id ? (
              <>
                <input
                  className={styles.composerInput}
                  type="datetime-local"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button variant="outline" onClick={() => save(row.user_id)} disabled={updateDeadline.isPending}>
                  Сохранить
                </Button>
                <Button variant="outline" onClick={() => setEditingUserId(null)}>
                  Отмена
                </Button>
              </>
            ) : (
              <>
                <span className={styles.rosterDeadline}>
                  {row.deadline_at ? dateTimeMsk(row.deadline_at) : 'без срока'}
                </span>
                <Button variant="outline" onClick={() => startEdit(row)}>
                  Продлить срок
                </Button>
                {row.deadline_at && (
                  <Button variant="outline" onClick={() => resetToTaskDeadline(row.user_id)}>
                    Сбросить
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

const TYPE_LABEL: Record<TaskType, string> = {
  common: 'Общая',
  individual: 'Индивидуальная',
  pair: 'Парная',
  stream: 'Поток',
}

const TRACK_STATUS_LABEL: Record<string, string> = {
  assigned: 'Назначена',
  submitted: 'На проверке',
  returned: 'Возвращена',
  accepted: 'Принята',
}

const commentTime = (iso: string) => format(new Date(iso), 'd MMM, HH:mm', { locale: ru })

function trackChipKind(status: string): ChipKind {
  if (status === 'accepted') return 'accepted'
  if (status === 'returned') return 'returned'
  return 'neutral'
}

export function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>()
  const id = Number(taskId ?? '0')
  const { user } = useAuth()
  const { data: task, isLoading, isError } = useTask(id)
  const { data: tracks } = useTaskSubmissions(id)

  // isError отдельно от !task: без него 403/404 (доступ закрыли задним числом,
  // напр. сменой тарифа) с retry на query держал экран на спиннере, а не на
  // «не найдена» — данных никогда не будет, ждать нечего.
  if (isError) return <div className="center grow muted">Задача не найдена</div>
  if (isLoading) return <div className="center grow"><Spinner /></div>
  if (!task) return <div className="center grow muted">Задача не найдена</div>

  const isAdmin = user?.role === 'admin'
  // Экспедиция пройдена: раздел остаётся историей сданного — без новых сдач и
  // комментариев (бэкенд закрывает те же пути 403).
  const isGraduated = !!user?.graduated_at
  const bodyHtml = task.body ? DOMPurify.sanitize(marked.parse(task.body) as string) : ''

  // Автор перекрёстной задачи (участник, выдавший её партнёру внутри пары) —
  // он видит трек партнёра и вправе принять/вернуть, как админ по обычной задаче.
  const isCrossAuthor = task.pair_id != null && task.created_by === user?.id
  const canReview = isAdmin || isCrossAuthor

  const list = tracks ?? []
  // Индивидуальная задача участнику показывает только его трек; общая — все публичные.
  // Автор перекрёстной задачи видит трек партнёра (для проверки).
  const visibleTracks = canReview
    ? list
    : list.filter((t) => t.user_id === user?.id || task.type === 'common')
  const myTrack = list.find((t) => t.user_id === user?.id) ?? null

  // Возвращённую работу уже показываем прямо в композере (ReturnedFeedback, ниже,
  // рядом с формой пересдачи) — не дублируем тот же трек ещё раз в общем списке.
  const showsOwnReturnedAbove = !canReview && myTrack?.status === 'returned'
  const sectionTracks = showsOwnReturnedAbove
    ? visibleTracks.filter((t) => t.assignment_id !== myTrack!.assignment_id)
    : visibleTracks

  return (
    <div className={styles.viewer}>
      <PageHeader title={task.title} />
      <div className={styles.viewerHead}>
        <div className={styles.headChips}>
          <Badge tone="accent">{TYPE_LABEL[task.type]}</Badge>
          {task.my_status === 'accepted' && (
            <Chip kind="accepted">Принята</Chip>
          )}
          {task.my_status === 'returned' && (
            <Chip kind="returned">Возвращена на доработку</Chip>
          )}
          {task.deadline_soon && <Chip kind="soon">Подходит срок</Chip>}
        </div>
        {task.deadline_at && (
          <div className={styles.articleMeta}>Дедлайн: {dateTimeMsk(task.deadline_at)}</div>
        )}
        {task.kb_item_id != null && (
          <Link className={styles.kbLink} to={`/kb/${task.kb_item_id}`}>
            <IconBook size={15} /> Материал в базе знаний
          </Link>
        )}
      </div>

      {bodyHtml && (
        <div className={styles.articleBody} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      )}

      {/* Медиа условия задачи (прикреплённое админом) — видно всем, кто видит задачу. */}
      {task.attachments.length > 0 && (
        <div className={styles.submissionMedia}>
          {task.attachments.map((att) => (
            <Attachment key={att.asset_id} attachment={att} />
          ))}
        </div>
      )}

      {/* Ростер видящих общую задачу для админа (ARG-133) — кто сдал/не сдал,
          продление срока одному конкретному участнику. */}
      {isAdmin && task.type === 'common' && <RosterSection taskId={id} />}

      {/* Парное задание: панель пары(-ей) вместо стандартной сдачи/треков.
          Сама сдача/приёмка живёт в перекрёстных задачах (открываются по ссылке). */}
      {task.type === 'pair' && (
        <PairPanel taskId={id} pairs={task.pairs ?? []} isAdmin={isAdmin} />
      )}

      {/* Поток: турнирная сетка со своей лестницей стадий. Сдача и треки не нужны —
          работа участника это его версии текста внутри сетки. */}
      {task.type === 'stream' && task.stream && (
        <StreamPanel taskId={id} stream={task.stream} isAdmin={isAdmin} />
      )}

      {/* Участник: композер сдачи + свой статус (админ и автор перекрёстной задачи
          сами её не сдают — только проверяют). */}
      {task.type !== 'pair' && task.type !== 'stream' && !canReview && (
        <section className={styles.section}>
          {myTrack && (
            <div className={styles.myStatusRow}>
              <span className={styles.myStatusLabel}>Статус:</span>
              <Chip kind={trackChipKind(myTrack.status)}>
                {TRACK_STATUS_LABEL[myTrack.status] ?? myTrack.status}
              </Chip>
              {myTrack.late && <Chip kind="late">Сдано позже</Chip>}
            </div>
          )}
          {/* Возвращена — комментарий проверяющего и предыдущая сдача прямо тут,
              рядом с формой пересдачи, а не где-то ниже среди всех треков. */}
          {showsOwnReturnedAbove && myTrack && <ReturnedFeedback track={myTrack} />}
          {/* Выпускник свою сдачу видит, но дослать/переслать уже не может. */}
          {!isGraduated && <TaskComposer taskId={id} status={myTrack?.status} />}
        </section>
      )}

      {/* Треки со сдачами: общая — все публичные, индивидуальная — только свой.
          Для парного задания треков нет (сдачи — в перекрёстных задачах).
          Проверяющему делим на «на проверке» и «принятые», чтобы новые сдачи было
          сразу видно и они не тонули среди уже принятых. Свой возвращённый трек уже
          показан выше (ReturnedFeedback) — секцию для него не дублируем; если после
          фильтра участнику показывать больше нечего, секцию не рендерим вовсе. */}
      {task.type !== 'pair' && task.type !== 'stream' && (canReview || sectionTracks.length > 0) && (
        <TracksSection
          title={task.type === 'common' && !isAdmin ? 'Работы участников' : 'Сдачи'}
          tracks={sectionTracks}
          taskId={id}
          canReview={canReview}
        />
      )}
    </div>
  )
}

// Возврат на доработку: комментарий проверяющего — самое важное, поэтому сверху;
// прошлая сдача — под ним, свёрнута в <details> (важно, что она никуда не делась,
// но перечитывать её целиком заново не обязательно). Обе — про ОДНУ последнюю
// сдачу трека: комментарий пишется именно на неё (см. review_assignment).
function ReturnedFeedback({ track }: { track: TaskTrackOut }) {
  const latest = track.submissions[track.submissions.length - 1]
  if (!latest) return null
  const bodyHtml = latest.body ? DOMPurify.sanitize(marked.parse(latest.body) as string) : ''

  return (
    <div className={styles.returnedPanel}>
      <div className={styles.returnedPanelTitle}>Комментарий проверяющего</div>
      <SubmissionComments submissionId={latest.id} />
      <details className={styles.returnedPrev}>
        <summary className={styles.returnedPrevSummary}>
          Твоя предыдущая сдача · {dateTimeMsk(latest.created_at)}
        </summary>
        {bodyHtml && (
          <div className={styles.submissionBody} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        )}
        {latest.attachments.length > 0 && (
          <div className={styles.submissionMedia}>
            {latest.attachments.map((att) => (
              <Attachment key={att.asset_id} attachment={att} />
            ))}
          </div>
        )}
      </details>
    </div>
  )
}

// Трек «требует внимания», пока не принят (есть сдача на проверке или возвращён).
const PENDING_STATUSES = new Set(['submitted', 'returned'])

function TracksSection({
  title,
  tracks,
  taskId,
  canReview,
}: {
  title: string
  tracks: TaskTrackOut[]
  taskId: number
  canReview: boolean
}) {
  if (tracks.length === 0) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <div className={styles.emptyNote}>Пока никто ничего не сдал.</div>
      </section>
    )
  }

  const pending = tracks.filter((t) => PENDING_STATUSES.has(t.status))
  const accepted = tracks.filter((t) => t.status === 'accepted')
  const other = tracks.filter(
    (t) => !PENDING_STATUSES.has(t.status) && t.status !== 'accepted',
  )

  return (
    <>
      {pending.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>На проверке ({pending.length})</h2>
          {pending.map((track) => (
            <TrackCard key={track.assignment_id} track={track} taskId={taskId} isAdmin={canReview} />
          ))}
        </section>
      )}

      {/* Треки без сдач (assigned) показываем проверяющему как «ожидают сдачи». */}
      {canReview && other.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Ожидают сдачи ({other.length})</h2>
          {other.map((track) => (
            <TrackCard key={track.assignment_id} track={track} taskId={taskId} isAdmin={canReview} />
          ))}
        </section>
      )}

      {accepted.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Принятые ({accepted.length})</h2>
          {accepted.map((track) => (
            <TrackCard
              key={track.assignment_id}
              track={track}
              taskId={taskId}
              isAdmin={canReview}
              defaultCollapsed
            />
          ))}
        </section>
      )}
    </>
  )
}

// Экспортирован — переиспользуется в AdminReview.tsx (раздел «Проверка», ARG-134),
// чтобы не дублировать разметку/логику приёма-возврата сдачи.
export function TrackCard({
  track,
  taskId,
  isAdmin,
  defaultCollapsed = false,
}: {
  track: TaskTrackOut
  taskId: number
  isAdmin: boolean
  defaultCollapsed?: boolean
}) {
  const users = useUsersMap()
  const review = useReview()
  const [comment, setComment] = useState('')
  // Принятые сдачи по умолчанию свёрнуты — раскрываются по клику на заголовок.
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const submitter = users.get(track.user_id)
  const name = submitter?.display_name ?? `Участник #${track.user_id}`

  function accept() {
    if (review.isPending) return
    review.mutate(
      { assignmentId: track.assignment_id, taskId, action: 'accept' },
      {
        onSuccess: () => toast('Принято'),
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function returnWithComment() {
    if (review.isPending) return
    const value = comment.trim()
    review.mutate(
      { assignmentId: track.assignment_id, taskId, action: 'return', comment: value || undefined },
      {
        onSuccess: () => {
          setComment('')
          toast('Возвращено на доработку')
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  return (
    <div className={styles.track}>
      <div
        className={styles.trackHead}
        onClick={() => setCollapsed((v) => !v)}
        style={{ cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed((v) => !v)
          }
        }}
      >
        <span className={styles.trackToggle} aria-hidden>{collapsed ? '▸' : '▾'}</span>
        <Avatar name={name} url={submitter?.avatar_url} size={32} />
        <span className={styles.trackName}>{name}</span>
        <div className={styles.trackChips}>
          <Chip kind={trackChipKind(track.status)}>
            {TRACK_STATUS_LABEL[track.status] ?? track.status}
          </Chip>
          {track.late && <Chip kind="late">Сдано позже</Chip>}
        </div>
      </div>

      {!collapsed && (
        <>
          {track.submissions.length === 0 && (
            <div className={styles.emptyNote}>Нет сдач.</div>
          )}
          {track.submissions.map((sub) => (
            <SubmissionBlock key={sub.id} sub={sub} name={name} />
          ))}

          {isAdmin && track.status === 'accepted' && (
            <div className={styles.emptyNote}>Задача принята.</div>
          )}

          {isAdmin && track.status !== 'accepted' && (
            <>
              <textarea
                className={styles.composerInput}
                placeholder="Комментарий при возврате на доработку (необязательно)…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                style={{ minHeight: 60, marginTop: 'var(--space-3)' }}
              />
              <div className={styles.reviewActions}>
                <Button type="button" onClick={accept} disabled={review.isPending}>
                  Принять
                </Button>
                <Button type="button" variant="outline" onClick={returnWithComment} disabled={review.isPending}>
                  Вернуть на доработку
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function SubmissionBlock({
  sub,
  name,
}: {
  sub: SubmissionOut
  name: string
}) {
  const bodyHtml = sub.body ? DOMPurify.sanitize(marked.parse(sub.body) as string) : ''
  return (
    <div className={styles.submission}>
      <div className={styles.submissionHead}>
        <span className={styles.submissionAuthor}>{name}</span>
        <span className={styles.submissionTime}>{dateTimeMsk(sub.created_at)}</span>
      </div>
      {bodyHtml && (
        <div className={styles.submissionBody} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      )}
      {sub.attachments.length > 0 && (
        <div className={styles.submissionMedia}>
          {sub.attachments.map((att) => (
            <Attachment key={att.asset_id} attachment={att} />
          ))}
        </div>
      )}
      <SubmissionComments submissionId={sub.id} />
    </div>
  )
}

function SubmissionComments({ submissionId }: { submissionId: number }) {
  const { data: comments } = useSubmissionComments(submissionId)
  const users = useUsersMap()
  const { user } = useAuth()
  const create = useCreateSubmissionComment(submissionId)
  const del = useDeleteTaskComment(submissionId)
  const [text, setText] = useState('')

  function submit() {
    const value = text.trim()
    if (!value || create.isPending) return
    create.mutate(value, {
      onSuccess: () => setText(''),
      onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Не удалось отправить', 'error'),
    })
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function remove(id: number) {
    if (!window.confirm('Удалить комментарий?')) return
    del.mutate(id, {
      onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Не удалось удалить', 'error'),
    })
  }

  const list = comments ?? []
  const isGraduated = !!user?.graduated_at

  return (
    <div className={styles.comments}>
      {!isGraduated && (
      <div className={styles.commentForm}>
        <textarea
          className={styles.commentInput}
          placeholder="Комментарий…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
        />
        {!!text.trim() && (
          <button
            className={styles.commentSend}
            type="button"
            onClick={submit}
            disabled={create.isPending}
            title="Отправить"
            aria-label="Отправить"
          >
            <IconSend size={16} />
          </button>
        )}
      </div>
      )}

      <ul className={styles.commentList}>
        {list.map((c) => {
          const author = users.get(c.author_id)
          const authorName = author?.display_name ?? `Участник #${c.author_id}`
          const canDelete = !isGraduated && (c.author_id === user?.id || user?.role === 'admin')
          return (
            <li key={c.id} className={styles.commentItem}>
              <Avatar name={authorName} url={author?.avatar_url} size={28} />
              <div className={styles.commentBody}>
                <div className={styles.commentHead}>
                  <span className={styles.commentAuthor}>{authorName}</span>
                  <span className={styles.commentTime}>{commentTime(c.created_at)}</span>
                  {canDelete && (
                    <button
                      className={styles.commentDelete}
                      onClick={() => remove(c.id)}
                      title="Удалить"
                      aria-label="Удалить комментарий"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className={styles.commentText}>{c.body}</div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
