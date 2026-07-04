import { useAdminCreditDay, useAdminDynamics } from '../../api/dynamics'
import { Avatar } from '../../components/Avatar'
import { IconAlert, IconCheck, IconFlame, IconUsers, IconWaves } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import type { DayStatus, DynamicsSummary, RecentDay, UserDynamicsOut } from '../../lib/types'
import styles from './admin.module.css'
import dynStyles from './dynamics.module.css'

// ─── Ячейка дня ──────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  closed:       '✓',
  credited:     '✓',
  missed:       '✗',
  pardoned:     '~',
  today_open:   '○',
  today_closed: '✓',
  before_start: '·',
  upcoming:     '·',
}

const STATUS_TEXT: Record<string, string> = {
  closed:       'Выполнено',
  credited:     'Зачтено',
  missed:       'Пропущено',
  pardoned:     'Помиловано',
  today_open:   'Сегодня',
  today_closed: 'Сегодня ✓',
  before_start: '—',
  upcoming:     'Впереди',
}

// Дни, которые админ может переключать вручную: пропущенный можно зачесть,
// зачтённый — снять. Остальные статусы не трогаем.
const TOGGLABLE: ReadonlySet<DayStatus> = new Set<DayStatus>(['missed', 'credited'])

const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

function DayCell({
  day,
  onToggle,
  busy,
}: {
  day: RecentDay
  onToggle?: (day: RecentDay) => void
  busy?: boolean
}) {
  const d = new Date(day.date + 'T00:00:00')
  const label = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
  const inner = (
    <>
      <span className={dynStyles.cellIcon}>{STATUS_ICON[day.status] ?? '·'}</span>
      <span className={dynStyles.cellDate}>{label}</span>
      <span className={dynStyles.cellLabel}>{STATUS_TEXT[day.status] ?? '—'}</span>
    </>
  )
  const cls = `${dynStyles.cell} ${dynStyles['cell_' + day.status]}`

  if (onToggle && TOGGLABLE.has(day.status)) {
    const willCredit = day.status === 'missed'
    return (
      <button
        type="button"
        className={`${cls} ${dynStyles.cellToggle}`}
        disabled={busy}
        title={willCredit ? `Зачесть ${label}` : `Снять зачёт ${label}`}
        onClick={() => onToggle(day)}
      >
        {inner}
      </button>
    )
  }
  return <div className={cls}>{inner}</div>
}

// ─── Карточка статистики ──────────────────────────────────────────────────────

function StatCard({ value, label, sub, accent }: { value: string | number; label: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`${dynStyles.statCard} ${accent ? dynStyles.statCardAccent : ''}`}>
      <span className={dynStyles.statValue}>{value}</span>
      <span className={dynStyles.statLabel}>{label}</span>
      {sub && <span className={dynStyles.statSub}>{sub}</span>}
    </div>
  )
}

// ─── Дашборд (сводка) ────────────────────────────────────────────────────────

function Dashboard({ s, total }: { s: DynamicsSummary; total: number }) {
  return (
    <div className={dynStyles.dashboard}>
      <div className={dynStyles.statRow}>
        <StatCard
          value={`${s.active_today} / ${total}`}
          label="Активны сегодня"
          sub="написали хоть что-то"
          accent
        />
        <StatCard
          value={`${s.journal_today} / ${total}`}
          label="ДЗ закрыто сегодня"
          sub="все три категории"
        />
        <StatCard
          value={`${s.no_overdue} / ${total}`}
          label="Без просрочек"
          sub="всё вовремя"
        />
        <StatCard
          value={s.avg_streak}
          label="Средний стрик"
          sub="дней подряд"
        />
      </div>
    </div>
  )
}

// ─── Карточка участника ───────────────────────────────────────────────────────

function UserCard({
  u,
  onToggleDay,
  busy,
}: {
  u: UserDynamicsOut
  onToggleDay: (userId: number, day: RecentDay) => void
  busy: boolean
}) {
  return (
    <div className={`${dynStyles.card} ${u.active_today ? dynStyles.cardActive : ''}`}>
      <div className={dynStyles.cardHeader}>
        <div className={dynStyles.cardAvatarWrap}>
          <Avatar name={u.display_name} url={u.avatar_url} size={36} />
          {u.active_today && <span className={dynStyles.onlineDot} title="Активен сегодня" />}
        </div>
        <div className={dynStyles.cardName}>
          <span className={dynStyles.displayName}>{u.display_name}</span>
          <span className={dynStyles.username}>@{u.username}</span>
        </div>
        <div className={dynStyles.badges}>
          {u.streak > 0 && (
            <span className={dynStyles.streakBadge}>
              <IconFlame size={12} /> {u.streak}
            </span>
          )}
          {u.overdue_count > 0 && (
            <span className={dynStyles.overdueBadge}>
              <IconAlert size={12} /> {u.overdue_count}
            </span>
          )}
          {u.pardons_used > 0 && (
            <span className={dynStyles.pardonBadge}>
              <IconWaves size={12} /> {u.pardons_used}/3
            </span>
          )}
          {u.overdue_count === 0 && u.streak > 0 && (
            <span className={dynStyles.okBadge}>
              <IconCheck size={12} />
            </span>
          )}
        </div>
      </div>

      <div className={dynStyles.days}>
        {u.recent_days.map((d) => (
          <DayCell
            key={d.date}
            day={d}
            busy={busy}
            onToggle={(day) => onToggleDay(u.user_id, day)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Основной компонент ───────────────────────────────────────────────────────

export function AdminDynamics() {
  const { data, isLoading } = useAdminDynamics()
  const creditDay = useAdminCreditDay()

  const handleToggleDay = (userId: number, day: RecentDay) => {
    if (creditDay.isPending) return
    // missed → зачесть, credited → снять зачёт.
    creditDay.mutate({ userId, date: day.date, credited: day.status === 'missed' })
  }

  if (isLoading) return <div className="center grow"><Spinner /></div>

  const users = data?.users ?? []
  const summary = data?.summary

  // Сортировка: сначала с просрочками, потом по убыванию стрика.
  const sorted = [...users].sort((a, b) => {
    if (b.overdue_count !== a.overdue_count) return b.overdue_count - a.overdue_count
    return b.streak - a.streak
  })

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Динамика</h1>
        <span style={{ fontSize: 'var(--text-ui)', color: 'var(--text-ghost)' }}>
          <IconUsers size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {summary?.total_participants ?? 0} участников
        </span>
      </div>

      <p style={{ fontSize: 'var(--text-ui)', color: 'var(--text-ghost)', marginTop: -4 }}>
        Кликните по пропущенному дню, чтобы зачесть его вручную (или по зачтённому — чтобы снять).
      </p>

      {summary && <Dashboard s={summary} total={summary.total_participants} />}

      {users.length === 0 && (
        <p style={{ color: 'var(--text-secondary)' }}>Участников пока нет.</p>
      )}

      <div className={dynStyles.grid}>
        {sorted.map((u) => (
          <UserCard
            key={u.user_id}
            u={u}
            busy={creditDay.isPending}
            onToggleDay={handleToggleDay}
          />
        ))}
      </div>
    </div>
  )
}
