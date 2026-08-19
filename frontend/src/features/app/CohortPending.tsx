import { differenceInCalendarDays } from 'date-fns'
import { IconCalendar } from '../../components/icons'
import { plural } from '../../lib/format'
import styles from './appshell.module.css'

/**
 * Заглушка Рубки/Календаря для участника, чей набор ещё не начался (ARG-106):
 * `today < intake.starts_on`. N — по календарным дням, без учёта времени старта
 * (см. Assumptions в задаче). Снимается сама собой в день старта — рендерится
 * только пока условие в AppShell истинно, отдельного «закрытия» не нужно.
 */
export function CohortPending({ startsOn }: { startsOn: string }) {
  const days = Math.max(0, differenceInCalendarDays(new Date(startsOn), new Date()))
  return (
    <div className={`center grow col ${styles.observerBlocked}`}>
      <span className={styles.observerBlockedIcon} aria-hidden>
        <IconCalendar />
      </span>
      <h2 className={styles.observerBlockedTitle}>Экспедиция ещё не началась</h2>
      <p className={styles.observerBlockedText}>
        До начала Экспедиции осталось {days} {plural(days, ['день', 'дня', 'дней'])}.
        Этот раздел откроется в день старта.
      </p>
    </div>
  )
}
