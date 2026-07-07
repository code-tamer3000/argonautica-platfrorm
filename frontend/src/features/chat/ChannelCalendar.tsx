import { useState } from 'react'
import { useJournalDays } from '../../api/messages'
import { useJournalStructure } from '../../api/journal'
import styles from './chat.module.css'

interface Props {
  roomId: number
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ChannelCalendar({ roomId }: Props) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const { data: days } = useJournalDays(roomId, year, month)
  const { data: structure } = useJournalStructure()
  const sectionKeys = structure?.sections.map((s) => s.key) ?? []
  const today = todayStr()

  // День закрыт (зелёный) — опубликованы все разделы активного задания; частичный —
  // есть, но не все. (Раскраска считает по текущему заданию; сам зачёт дня в Динамике
  // бэкенд считает по заданию, действовавшему в тот день.)
  const isClosed = (dateStr: string) =>
    sectionKeys.length > 0 && sectionKeys.every((k) => (days?.[dateStr] ?? []).includes(k))
  const isPartial = (dateStr: string) =>
    !isClosed(dateStr) && (days?.[dateStr]?.length ?? 0) > 0

  // First day-of-week (Mon=0) offset for the 1st of the month.
  const firstDay = new Date(year, month - 1, 1)
  const offset = (firstDay.getDay() + 6) % 7  // Mon-based
  const daysInMonth = new Date(year, month, 0).getDate()

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div className={styles.calendarWrap}>
      <div className={styles.calendarNav}>
        <button className={styles.calendarNavBtn} onClick={prevMonth} aria-label="Предыдущий месяц">‹</button>
        <span className={styles.calendarTitle}>{MONTHS[month - 1]} {year}</span>
        <button className={styles.calendarNavBtn} onClick={nextMonth} aria-label="Следующий месяц">›</button>
      </div>
      <div className={styles.calendarGrid}>
        {WEEKDAYS.map((d) => (
          <span key={d} className={styles.calendarWeekday}>{d}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e${i}`} />
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const closed = isClosed(dateStr)
          const partial = isPartial(dateStr)
          const isToday = dateStr === today
          return (
            <span
              key={dateStr}
              className={[
                styles.calendarDay,
                closed ? styles.calendarDayDone : '',
                partial ? styles.calendarDayPartial : '',
                isToday ? styles.calendarDayToday : '',
              ].filter(Boolean).join(' ')}
              title={
                closed ? 'День закрыт — все разделы'
                  : partial ? `Публикаций: ${days?.[dateStr]?.length ?? 0}/${sectionKeys.length}`
                    : undefined
              }
            >
              {day}
            </span>
          )
        })}
      </div>
    </div>
  )
}
