import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { useCalendarEvents } from '../../api/calendar'
import { useAuth } from '../auth/AuthContext'
import { Spinner } from '../../components/Spinner'
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconPin,
  IconTasks,
} from '../../components/icons'
import { dayKeyMsk, timeHMMsk } from '../../lib/format'
import type { CalendarEventOut } from '../../lib/types'
import styles from './calendar.module.css'

// Заголовок дедлайн-события хранится как «Дедлайн: <название>» — в календаре
// показываем мягко: иконка задачи + само название, без канцелярского префикса.
function taskEventTitle(title: string): string {
  return title.replace(/^Дедлайн:\s*/i, '')
}

const WEEK_OPTS = { weekStartsOn: 1 as const } // неделя с понедельника
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const dayKey = (d: Date) => format(d, 'yyyy-MM-dd')

export function CalendarView() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<Date>(() => new Date())

  // Диапазон видимой сетки (полные недели вокруг месяца).
  const gridStart = useMemo(() => startOfWeek(startOfMonth(month), WEEK_OPTS), [month])
  const gridEnd = useMemo(() => endOfWeek(endOfMonth(month), WEEK_OPTS), [month])
  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  )

  const { data, isLoading } = useCalendarEvents(
    gridStart.toISOString(),
    gridEnd.toISOString(),
  )

  // События, сгруппированные по дню (yyyy-MM-dd).
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEventOut[]>()
    for (const ev of data ?? []) {
      const key = dayKeyMsk(ev.starts_at)
      const arr = map.get(key) ?? []
      arr.push(ev)
      map.set(key, arr)
    }
    return map
  }, [data])

  const selectedEvents = useMemo(() => {
    const list = byDay.get(dayKey(selected)) ?? []
    return [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  }, [byDay, selected])

  const goToday = () => {
    const now = new Date()
    setMonth(startOfMonth(now))
    setSelected(now)
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.pageTitle}>{format(month, 'LLLL yyyy', { locale: ru })}</h1>
        <div className={styles.nav}>
          <button className={styles.todayBtn} onClick={goToday}>Сегодня</button>
          <button
            className={styles.navBtn}
            onClick={() => setMonth((m) => subMonths(m, 1))}
            aria-label="Предыдущий месяц"
          >
            <IconChevronLeft size={20} />
          </button>
          <button
            className={styles.navBtn}
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="Следующий месяц"
          >
            <IconChevronRight size={20} />
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        {WEEKDAYS.map((w) => (
          <div key={w} className={styles.weekday}>{w}</div>
        ))}
        {days.map((day) => {
          const events = byDay.get(dayKey(day)) ?? []
          const outside = !isSameMonth(day, month)
          const cls = [
            styles.cell,
            outside ? styles.cellOutside : '',
            isToday(day) ? styles.cellToday : '',
            isSameDay(day, selected) ? styles.cellSelected : '',
          ].join(' ')
          return (
            <button key={day.toISOString()} className={cls} onClick={() => setSelected(day)}>
              <span className={styles.cellNum}>{format(day, 'd')}</span>
              {events.length > 0 && (
                <span className={styles.dots}>
                  {events.slice(0, 3).map((ev) => (
                    <span
                      key={ev.id}
                      className={`${styles.dot} ${
                        ev.task_id != null
                          ? styles.dotTask
                          : ev.room_id != null
                            ? styles.dotRoom
                            : ''
                      }`}
                    />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className={styles.detail}>
        <div className={styles.detailHead}>
          {format(selected, 'EEEE, d MMMM', { locale: ru })}
        </div>
        {isLoading && <div className="center" style={{ padding: 24 }}><Spinner /></div>}
        {!isLoading && selectedEvents.length === 0 && (
          <div className="muted" style={{ padding: 'var(--space-3) 0' }}>
            В этот день событий нет
          </div>
        )}
        <div className={styles.eventList}>
          {selectedEvents.map((ev) => (
            <EventCard key={ev.id} ev={ev} isAdmin={isAdmin} />
          ))}
        </div>
      </div>
    </div>
  )
}

// Карточка события. Три интуитивно разных вида:
//  • дедлайн задачи (task_id) — мягкий, с иконкой задачи, кликабелен → к себе в
//    раздел «Задачи»; у выполненной галочка, у админа — прогресс «сдали X из Y»;
//  • событие комнаты — с меткой «В комнате»;
//  • анонс проекта — обычное событие.
function EventCard({ ev, isAdmin }: { ev: CalendarEventOut; isAdmin: boolean }) {
  const timeLabel = ev.all_day
    ? 'Весь день'
    : `${timeHMMsk(ev.starts_at)}${ev.ends_at ? ` — ${timeHMMsk(ev.ends_at)}` : ''} МСК`

  if (ev.task_id != null) {
    const done = ev.task_done
    const cls = `${styles.event} ${styles.eventTask} ${done ? styles.eventDone : ''} rise`
    return (
      <Link to={`/tasks/${ev.task_id}`} className={cls}>
        <div className={styles.eventTime}>{timeLabel}</div>
        <div className={styles.eventBody}>
          <div className={styles.eventTitle}>
            <span className={styles.taskIcon} aria-hidden>
              {done ? <IconCheck size={15} /> : <IconTasks size={15} />}
            </span>
            {taskEventTitle(ev.title)}
          </div>
          {ev.description && <div className={styles.eventDesc}>{ev.description}</div>}
          {isAdmin && ev.task_total_count != null ? (
            <span className={styles.taskTag}>
              сдали {ev.task_submitted_count} из {ev.task_total_count}
            </span>
          ) : (
            <span className={`${styles.taskTag} ${done ? styles.taskTagDone : ''}`}>
              {done ? 'Выполнено' : 'Ваша задача'}
            </span>
          )}
        </div>
      </Link>
    )
  }

  return (
    <div className={`${styles.event} rise`}>
      <div className={styles.eventTime}>{timeLabel}</div>
      <div className={styles.eventBody}>
        <div className={styles.eventTitle}>{ev.title}</div>
        {ev.description && <div className={styles.eventDesc}>{ev.description}</div>}
        {ev.room_id != null && (
          <span className={styles.roomTag}>
            <IconPin size={13} /> В комнате
          </span>
        )}
      </div>
    </div>
  )
}
