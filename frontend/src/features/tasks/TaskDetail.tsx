import { useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  useCreateSubmissionComment,
  useDeleteTaskComment,
  useReview,
  useSubmissionComments,
  useTask,
  useTaskSubmissions,
  type SubmissionOut,
  type TaskTrackOut,
  type TaskType,
} from '../../api/tasks'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { IconBook, IconSend } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { dateTimeMsk } from '../../lib/format'
import { toast } from '../../stores/toast'
import { useAuth } from '../auth/AuthContext'
import { Attachment } from '../chat/Attachment'
import { TaskComposer } from './TaskComposer'
import styles from './tasks.module.css'

const TYPE_LABEL: Record<TaskType, string> = {
  common: 'Общая',
  individual: 'Индивидуальная',
}

const TRACK_STATUS_LABEL: Record<string, string> = {
  assigned: 'Назначена',
  submitted: 'На проверке',
  returned: 'Возвращена',
  accepted: 'Принята',
}

const commentTime = (iso: string) => format(new Date(iso), 'd MMM, HH:mm', { locale: ru })

function trackChipClass(status: string): string {
  if (status === 'accepted') return `${styles.chip} ${styles.chipAccepted}`
  if (status === 'returned') return `${styles.chip} ${styles.chipReturned}`
  return styles.chip
}

export function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>()
  const id = Number(taskId ?? '0')
  const { user } = useAuth()
  const { data: task, isLoading } = useTask(id)
  const { data: tracks } = useTaskSubmissions(id)

  if (isLoading) return <div className="center grow"><Spinner /></div>
  if (!task) return <div className="center grow muted">Задача не найдена</div>

  const isAdmin = user?.role === 'admin'
  const bodyHtml = task.body ? DOMPurify.sanitize(marked.parse(task.body) as string) : ''

  const list = tracks ?? []
  // Индивидуальная задача участнику показывает только его трек; общая — все публичные.
  const visibleTracks = isAdmin ? list : list.filter((t) => t.user_id === user?.id || task.type === 'common')
  const myTrack = list.find((t) => t.user_id === user?.id) ?? null

  return (
    <div className={styles.viewer}>
      <div className={styles.viewerHead}>
        <div className={styles.headChips}>
          <span className={`${styles.badge} ${styles.badgeType}`}>{TYPE_LABEL[task.type]}</span>
          {task.my_status === 'accepted' && (
            <span className={`${styles.chip} ${styles.chipAccepted}`}>Принята</span>
          )}
          {task.my_status === 'returned' && (
            <span className={`${styles.chip} ${styles.chipReturned}`}>Возвращена на доработку</span>
          )}
          {task.deadline_soon && <span className={`${styles.chip} ${styles.chipSoon}`}>Подходит срок</span>}
        </div>
        <h1 className={styles.articleTitle}>{task.title}</h1>
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

      {/* Участник: композер сдачи + свой статус (админ сам задачи не сдаёт). */}
      {!isAdmin && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Моя работа</h2>
          {myTrack && (
            <div className={styles.myStatusRow}>
              <span className={styles.myStatusLabel}>Статус:</span>
              <span className={trackChipClass(myTrack.status)}>
                {TRACK_STATUS_LABEL[myTrack.status] ?? myTrack.status}
              </span>
              {myTrack.late && <span className={`${styles.chip} ${styles.chipLate}`}>Сдано позже</span>}
            </div>
          )}
          <TaskComposer taskId={id} status={myTrack?.status} />
        </section>
      )}

      {/* Треки со сдачами: общая — все публичные, индивидуальная — только свой. */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {task.type === 'common' && !isAdmin ? 'Работы участников' : 'Сдачи'}
        </h2>
        {visibleTracks.length === 0 && (
          <div className={styles.emptyNote}>Пока никто ничего не сдал.</div>
        )}
        {visibleTracks.map((track) => (
          <TrackCard key={track.assignment_id} track={track} taskId={id} isAdmin={isAdmin} />
        ))}
      </section>
    </div>
  )
}

function TrackCard({
  track,
  taskId,
  isAdmin,
}: {
  track: TaskTrackOut
  taskId: number
  isAdmin: boolean
}) {
  const users = useUsersMap()
  const review = useReview()
  const [comment, setComment] = useState('')
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
      <div className={styles.trackHead}>
        <Avatar name={name} url={submitter?.avatar_url} size={32} />
        <span className={styles.trackName}>{name}</span>
        <div className={styles.trackChips}>
          <span className={trackChipClass(track.status)}>
            {TRACK_STATUS_LABEL[track.status] ?? track.status}
          </span>
          {track.late && <span className={`${styles.chip} ${styles.chipLate}`}>Сдано позже</span>}
        </div>
      </div>

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

  return (
    <div className={styles.comments}>
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

      <ul className={styles.commentList}>
        {list.map((c) => {
          const author = users.get(c.author_id)
          const authorName = author?.display_name ?? `Участник #${c.author_id}`
          const canDelete = c.author_id === user?.id || user?.role === 'admin'
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
