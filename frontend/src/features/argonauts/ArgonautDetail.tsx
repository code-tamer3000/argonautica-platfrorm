import { Link, useNavigate, useParams } from 'react-router-dom'
import { useArgonaut } from '../../api/argonauts'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { Chip } from '../../components/Chip'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import { ApiError } from '../../lib/apiClient'
import { dateTimeMsk } from '../../lib/format'
import type { ArgonautTaskOut } from '../../lib/types'
import styles from './argonauts.module.css'

function TaskRow({ task }: { task: ArgonautTaskOut }) {
  return (
    <Link to={`/tasks/${task.task_id}`} className={styles.taskRow}>
      <span className={styles.taskTitle}>{task.title}</span>
      <span className={styles.taskMeta}>
        {task.status === 'accepted' ? (
          <Chip kind="accepted">Принята</Chip>
        ) : (
          <Chip kind="unreviewed">На проверке</Chip>
        )}
        {task.deadline_at && <span className={styles.taskDeadline}>{dateTimeMsk(task.deadline_at)}</span>}
      </span>
    </Link>
  )
}

export function ArgonautDetail() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const { data, isLoading, error } = useArgonaut(Number(userId))

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
        <Avatar name={data.display_name} url={data.avatar_url} size={88} />
        <div className={styles.profileName}>{data.display_name}</div>
        <div className={styles.profileUsername}>@{data.username}</div>
        {(data.role === 'admin' || data.plan_name) && (
          <div className={styles.profileRole}>
            {data.role === 'admin' ? 'Администратор' : data.plan_name}
          </div>
        )}
        {data.bio && <div className={styles.profileBio}>{data.bio}</div>}
        {data.expedition_feat && (
          <div className={styles.featBlock}>
            <div className={styles.featLabel}>Подвиг на Экспедицию</div>
            <div className={styles.featText}>{data.expedition_feat}</div>
          </div>
        )}
        {data.diary_room_id != null && (
          <Button variant="outline" onClick={() => navigate(`/diaries/${data.diary_room_id}`)}>
            Перейти в дневник
          </Button>
        )}
      </div>

      {data.role !== 'admin' && (
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
