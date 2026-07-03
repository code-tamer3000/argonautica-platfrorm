import { useAdminDynamics } from '../../api/dynamics'
import { Avatar } from '../../components/Avatar'
import { Spinner } from '../../components/Spinner'
import type { RecentDay } from '../../lib/types'
import styles from './admin.module.css'
import dynStyles from './dynamics.module.css'

const STATUS_ICON: Record<string, string> = {
  closed: '✓',
  missed: '✗',
  pardoned: '🐋',
  today_open: '○',
  today_closed: '✓',
  before_start: '·',
}

const STATUS_TITLE: Record<string, string> = {
  closed: 'Выполнено',
  missed: 'Пропущено',
  pardoned: 'Помиловано',
  today_open: 'Сегодня (ещё открыт)',
  today_closed: 'Сегодня — выполнено',
  before_start: 'До начала программы',
}

function DayDot({ day }: { day: RecentDay }) {
  const date = new Date(day.date + 'T00:00:00')
  const label = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  return (
    <div className={`${dynStyles.dot} ${dynStyles['dot_' + day.status]}`} title={`${label}: ${STATUS_TITLE[day.status]}`}>
      {STATUS_ICON[day.status] ?? '·'}
    </div>
  )
}

export function AdminDynamics() {
  const { data: users, isLoading } = useAdminDynamics()

  if (isLoading) return <div className="center grow"><Spinner /></div>

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Динамика</h1>
      </div>

      {(!users || users.length === 0) && (
        <p style={{ color: 'var(--text-secondary)' }}>Участников пока нет.</p>
      )}

      <div className={dynStyles.grid}>
        {users?.map((u) => (
          <div key={u.user_id} className={dynStyles.card}>
            <div className={dynStyles.cardHeader}>
              <Avatar name={u.display_name} url={u.avatar_url} size={36} />
              <div className={dynStyles.cardName}>
                <span className={dynStyles.displayName}>{u.display_name}</span>
                <span className={dynStyles.username}>@{u.username}</span>
              </div>
              <div className={dynStyles.badges}>
                <span className={dynStyles.streakBadge} title="Текущий стрик">
                  🔥 {u.streak}
                </span>
                {u.overdue_count > 0 && (
                  <span className={dynStyles.overdueBadge} title="Просроченных дней">
                    ✗ {u.overdue_count}
                  </span>
                )}
                {u.pardons_used > 0 && (
                  <span className={dynStyles.pardonBadge} title={`Использовано помилований: ${u.pardons_used}/3`}>
                    🐋 {u.pardons_used}/3
                  </span>
                )}
              </div>
            </div>
            <div className={dynStyles.days}>
              {u.recent_days.map((d) => (
                <DayDot key={d.date} day={d} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
