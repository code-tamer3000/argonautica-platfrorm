import { useState } from 'react'
import { useAdminIntakes } from '../../api/admin'
import { useAdminCreditDay, useAdminDynamics } from '../../api/dynamics'
import { Avatar } from '../../components/Avatar'
import { IconAlert, IconCheck, IconCompass, IconFlame, IconUsers, IconWaves } from '../../components/icons'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import type {
  DayStatus,
  DynamicsSummary,
  IntakeOut,
  RecentDay,
  UserDynamicsOut,
} from '../../lib/types'
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

// Дни, которые админ может переключать вручную: пропущенный — зачесть; помилованный
// (потрачен кит) — зачесть с возвратом кита; зачтённый — снять зачёт. Остальные не трогаем.
const TOGGLABLE: ReadonlySet<DayStatus> = new Set<DayStatus>(['missed', 'pardoned', 'credited'])

/** `YYYY-MM-DD` → «2 июня 2026». Дата набора — календарная, без часовых поясов. */
function intakeDate(startsOn: string): string {
  return new Date(`${startsOn}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

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
    // credited → снять зачёт; pardoned → зачесть и вернуть кита; missed → зачесть.
    const title =
      day.status === 'credited'
        ? `Снять зачёт ${label}`
        : day.status === 'pardoned'
          ? `Зачесть ${label} и вернуть кита`
          : `Зачесть ${label}`
    return (
      <button
        type="button"
        className={`${cls} ${dynStyles.cellToggle}`}
        disabled={busy}
        title={title}
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
    <div
      className={`${dynStyles.card} ${u.active_today ? dynStyles.cardActive : ''} ${
        u.graduated_at ? dynStyles.cardGraduated : ''
      }`}
    >
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
          {/* Экспедиция пройдена: дальше динамика не идёт — цифры ниже это картина
              на день выпуска, а не сегодняшняя. */}
          {u.graduated_at && (
            <span
              className={dynStyles.graduatedBadge}
              title={`Экспедиция пройдена ${new Date(u.graduated_at).toLocaleDateString('ru-RU')}`}
            >
              <IconCompass size={12} /> Прошёл Экспедицию
            </span>
          )}
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
  const { data: intakes = [], isLoading: intakesLoading } = useAdminIntakes()
  // Наборы приходят свежими сверху: активный — тот, что стартует последним.
  const activeIntake: IntakeOut | undefined = intakes[0]

  // null — фильтр не трогали: показываем активный набор. 'all' — все наборы.
  const [intakeFilter, setIntakeFilter] = useState<number | 'all' | null>(null)
  const selectedIntake: number | 'all' = intakeFilter ?? activeIntake?.id ?? 'all'

  const { data, isLoading } = useAdminDynamics(
    selectedIntake === 'all' ? undefined : selectedIntake,
    !intakesLoading,
  )
  const creditDay = useAdminCreditDay()

  const handleToggleDay = (userId: number, day: RecentDay) => {
    if (creditDay.isPending) return
    // credited → снять зачёт; missed/pardoned → зачесть (для pardoned кит вернётся).
    creditDay.mutate({ userId, date: day.date, credited: day.status !== 'credited' })
  }

  // Ждём наборы: до них неизвестно, какой набор активен и чем фильтровать.
  if (intakesLoading || isLoading) return <div className="center grow"><Spinner /></div>

  const users = data?.users ?? []
  const summary = data?.summary

  // Сортировка: сначала с просрочками, потом по убыванию стрика.
  const sorted = [...users].sort((a, b) => {
    // Выпускники — в конец: их динамика заморожена, реагировать на неё уже не нужно.
    const graduated = Number(!!a.graduated_at) - Number(!!b.graduated_at)
    if (graduated !== 0) return graduated
    if (b.overdue_count !== a.overdue_count) return b.overdue_count - a.overdue_count
    return b.streak - a.streak
  })

  const renderCard = (u: UserDynamicsOut) => (
    <UserCard
      key={u.user_id}
      u={u}
      busy={creditDay.isPending}
      onToggleDay={handleToggleDay}
    />
  )

  // В режиме «все наборы» карточки группируем по набору (свежие сверху) — иначе
  // это снова плоский список, из которого не видно, кто откуда.
  const orphans = sorted.filter((u) => u.intake_id === null)

  return (
    <div className={styles.page}>
      <PageHeader title="Динамика">
        <span style={{ fontSize: 'var(--text-ui)', color: 'var(--text-ghost)' }}>
          <IconUsers size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {summary?.total_participants ?? 0} участников
        </span>
      </PageHeader>

      <p style={{ fontSize: 'var(--text-ui)', color: 'var(--text-ghost)', marginTop: -4 }}>
        Кликните по пропущенному дню, чтобы зачесть его вручную (по зачтённому — снять). Зачёт помилованного дня вернёт участнику потраченного кита.
      </p>

      {intakes.length > 0 && (
        <div className={styles.formRow} style={{ maxWidth: 420 }}>
          <label htmlFor="dyn_intake_filter">Набор</label>
          <select
            id="dyn_intake_filter"
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
      )}

      {summary && <Dashboard s={summary} total={summary.total_participants} />}

      {users.length === 0 && (
        <p style={{ color: 'var(--text-secondary)' }}>
          {selectedIntake === 'all'
            ? 'Участников пока нет.'
            : 'В этом наборе пока нет участников.'}
        </p>
      )}

      {selectedIntake !== 'all' ? (
        <div className={dynStyles.grid}>{sorted.map(renderCard)}</div>
      ) : (
        <>
          {intakes.map((intake) => {
            const groupUsers = sorted.filter((u) => u.intake_id === intake.id)
            if (groupUsers.length === 0) return null
            return (
              <section key={intake.id}>
                <h2 className={styles.sectionTitle}>
                  Набор от {intakeDate(intake.starts_on)}
                  {intake.id === activeIntake?.id ? ' — активный' : ''}
                </h2>
                <div className={dynStyles.grid}>{groupUsers.map(renderCard)}</div>
              </section>
            )
          })}
          {orphans.length > 0 && (
            <section>
              <h2 className={styles.sectionTitle}>Без набора</h2>
              <div className={dynStyles.grid}>{orphans.map(renderCard)}</div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
