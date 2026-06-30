import { useMemo } from 'react'
import { useCalendarEvents } from '../../api/calendar'
import { Spinner } from '../../components/Spinner'
import { dayLabel, timeHM } from '../../lib/format'
import type { CalendarEventOut } from '../../lib/types'
import styles from './calendar.module.css'

export function CalendarView() {
  // From today to +90 days
  const from = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }, [])
  const to = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 90)
    return d.toISOString()
  }, [])

  const { data, isLoading } = useCalendarEvents(from, to)

  // Group by day label
  const groups = useMemo(() => {
    if (!data) return []
    const map = new Map<string, CalendarEventOut[]>()
    for (const ev of data) {
      const label = dayLabel(ev.starts_at)
      const arr = map.get(label) ?? []
      arr.push(ev)
      map.set(label, arr)
    }
    return Array.from(map.entries())
  }, [data])

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Календарь</h1>
      {isLoading && <div className="center" style={{ padding: 40 }}><Spinner /></div>}
      {!isLoading && groups.length === 0 && (
        <div className="center muted" style={{ padding: 40 }}>
          Ближайших событий нет
        </div>
      )}
      {groups.map(([label, events]) => (
        <div key={label} className={styles.dayGroup}>
          <div className={styles.dayLabel}>{label}</div>
          <div className={styles.eventList}>
            {events.map((ev) => (
              <div key={ev.id} className={styles.event}>
                <div className={styles.eventTime}>
                  {ev.all_day ? 'Весь день' : timeHM(ev.starts_at)}
                  {ev.ends_at && !ev.all_day && ` — ${timeHM(ev.ends_at)}`}
                </div>
                <div className={styles.eventBody}>
                  <div className={styles.eventTitle}>{ev.title}</div>
                  {ev.description && (
                    <div className={styles.eventDesc}>
                      {ev.description.slice(0, 120)}
                      {ev.description.length > 120 ? '…' : ''}
                    </div>
                  )}
                  {ev.room_id != null && (
                    <span className={styles.roomTag}>📌 В комнате</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
