import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { argonautKey, useArgonaut } from '../../api/argonauts'
import { useCreateRoom } from '../../api/rooms'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { Chip } from '../../components/Chip'
import { EmptyState } from '../../components/EmptyState'
import { Lightbox } from '../../components/Overlay'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../auth/AuthContext'
import { TaskComposer } from '../tasks/TaskComposer'
import { ApiError } from '../../lib/apiClient'
import { dateTimeMsk } from '../../lib/format'
import type { ArgonautTaskOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import styles from './argonauts.module.css'

// Клик по строке разворачивает текст сдачи на месте (ARG-119) — переход на
// /tasks/{id} со списком всех сдач подряд остаётся, но второстепенной ссылкой,
// для тех редких случаев, когда всё же нужна полная карточка задачи.
function TaskRow({ task }: { task: ArgonautTaskOut }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.taskItem}>
      <button
        type="button"
        className={styles.taskRow}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.taskTitle}>{task.title}</span>
        <span className={styles.taskMeta}>
          {task.status === 'accepted' ? (
            <Chip kind="accepted">Принята</Chip>
          ) : (
            <Chip kind="unreviewed">На проверке</Chip>
          )}
          {task.deadline_at && <span className={styles.taskDeadline}>{dateTimeMsk(task.deadline_at)}</span>}
        </span>
      </button>
      {open && (
        <div className={styles.taskSubmission}>
          {task.submission_text ? (
            <div className={styles.taskSubmissionText}>{task.submission_text}</div>
          ) : (
            <div className={styles.taskSubmissionEmpty}>Текст сдачи недоступен.</div>
          )}
          <Link to={`/tasks/${task.task_id}`} className={styles.taskSubmissionLink}>
            Открыть задачу
          </Link>
        </div>
      )}
    </div>
  )
}

export function ArgonautDetail() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const createRoom = useCreateRoom()
  const setDmPeer = useUiStore((s) => s.setDmPeer)
  const numericId = Number(userId)
  const { data, isLoading, error } = useArgonaut(numericId)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const isOwn = me?.id === numericId

  async function handleWrite() {
    try {
      const room = await createRoom.mutateAsync({ type: 'dm', peer_id: numericId })
      setDmPeer(room.id, numericId)
      navigate(`/chats/${room.id}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось открыть чат', 'error')
    }
  }

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className={styles.wrap}>
        <PageHeader title="Аргонавты" />
        <EmptyState size="block">Участник не найден.</EmptyState>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className={styles.wrap}>
        <PageHeader title="Аргонавты" />
        <div className="center grow">
          <Spinner />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <PageHeader title={data.display_name} />
      <div className={styles.profileCard}>
        <button
          type="button"
          className={styles.avatarBtn}
          onClick={() => data.avatar_url && setAvatarOpen(true)}
          disabled={!data.avatar_url}
          aria-label="Открыть фото"
        >
          <Avatar name={data.display_name} url={data.avatar_url} size={88} />
        </button>
        {avatarOpen && data.avatar_url && (
          <Lightbox url={data.avatar_url} kind="image" onClose={() => setAvatarOpen(false)} />
        )}
        <div className={styles.profileName}>{data.display_name}</div>
        <div className={styles.profileUsername}>@{data.username}</div>
        {(data.role === 'admin' || data.plan_name) && (
          <div className={styles.profileRole}>
            {data.role === 'admin' ? 'Администратор' : data.plan_name}
          </div>
        )}
        {data.bio && <div className={styles.profileBio}>{data.bio}</div>}
        {(data.expedition_feat || (isOwn && data.expedition_feat_task_id != null)) && (
          <div className={styles.featBlock}>
            <div className={styles.featLabel}>Подвиг на Экспедицию</div>
            {data.expedition_feat && <div className={styles.featText}>{data.expedition_feat}</div>}
            {isOwn && data.expedition_feat_task_id != null && (
              <TaskComposer
                taskId={data.expedition_feat_task_id}
                status={data.expedition_feat_status ?? undefined}
                onSubmitted={() => qc.invalidateQueries({ queryKey: argonautKey(numericId) })}
              />
            )}
          </div>
        )}
        {!isOwn && data.can_message && !me?.graduated_at && (
          <Button variant="gold" onClick={handleWrite} disabled={createRoom.isPending}>
            {createRoom.isPending ? <Spinner size={16} /> : 'Написать сообщение'}
          </Button>
        )}
        {data.diary_room_id != null && (
          <Button variant="outline" onClick={() => navigate(`/diaries/${data.diary_room_id}`)}>
            Перейти в дневник
          </Button>
        )}
      </div>

      {data.role !== 'admin' && !data.is_observer && (
        <div className={styles.tasksSection}>
          <h2 className={styles.tasksHeading}>Задачи ({data.tasks_done})</h2>
          {data.tasks.length === 0 ? (
            <EmptyState>Пока нет сданных задач.</EmptyState>
          ) : (
            <div className={styles.taskList}>
              {data.tasks.map((t) => (
                <TaskRow key={t.task_id} task={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
