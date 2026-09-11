import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMyDynamicsDays } from '../../api/dynamics'
import { fetchJournalAnchor, useJournalDays } from '../../api/messages'
import { useRooms } from '../../api/rooms'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { DAY_STATUS_TEXT } from '../../lib/dynamicsStatus'
import type { RecentDay } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useAuth } from '../auth/AuthContext'
import styles from './profile.module.css'

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function shortLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

function fullLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Клетка календаря сама решает свой цвет по DayStatus — участнику `credited`
// приходит уже как `closed` (бэкенд схлопывает разницу, см. docs/DYNAMICS.md),
// поэтому здесь достаточно четырёх видов начертания.
function cellClass(status: RecentDay['status']): string {
  switch (status) {
    case 'closed':
    case 'today_closed':
      return styles.dayCellDone
    case 'partial':
      return styles.dayCellPartial
    case 'pardoned':
      return styles.dayCellPardoned
    case 'missed':
      return styles.dayCellMissed
    case 'today_open':
      return styles.dayCellToday
    default:
      return styles.dayCellFuture
  }
}

function DayDetails({ day, onClose }: { day: RecentDay; onClose: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data: rooms } = useRooms()
  const myDiaryRoomId = rooms?.find((r) => r.is_personal && r.created_by === user?.id)?.id
  const d = new Date(day.date + 'T00:00:00')
  const { data: sections } = useJournalDays(
    myDiaryRoomId ?? 0, d.getFullYear(), d.getMonth() + 1, myDiaryRoomId != null,
  )
  const [going, setGoing] = useState(false)
  const daySections = sections?.[day.date] ?? []

  async function goToDiary() {
    if (myDiaryRoomId == null) return
    setGoing(true)
    try {
      const anchor = await fetchJournalAnchor(myDiaryRoomId, day.date)
      if (anchor.message_id == null) {
        toast('Записей в дневнике пока нет', 'error')
        return
      }
      navigate(`/diaries/${myDiaryRoomId}?anchor=${anchor.message_id}`)
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось открыть дневник', 'error')
    } finally {
      setGoing(false)
    }
  }

  return (
    <Modal title={fullLabel(day.date)} onClose={onClose}>
      <div className={styles.dayModalBody}>
        <p className={styles.dayModalStatus}>{DAY_STATUS_TEXT[day.status]}</p>
        {daySections.length > 0 && (
          <p className={styles.dayModalSections}>Записано: {daySections.join(', ')}</p>
        )}
        {myDiaryRoomId != null && (
          <button className="btn btn-gold" onClick={goToDiary} disabled={going}>
            {going ? 'Открываю…' : 'Открыть в дневнике'}
          </button>
        )}
      </div>
    </Modal>
  )
}

export function DynamicsCalendar() {
  const { data: days, isLoading } = useMyDynamicsDays()
  const [openDay, setOpenDay] = useState<RecentDay | null>(null)

  if (isLoading) return (
    <div className="center" style={{ padding: 'var(--space-4)' }}><Spinner size={18} /></div>
  )
  if (!days || days.length === 0) return null

  return (
    <div className={styles.calendarWrap}>
      <div className={styles.dayGrid}>
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            className={`${styles.dayCell} ${cellClass(d.status)}`}
            title={DAY_STATUS_TEXT[d.status]}
            onClick={() => setOpenDay(d)}
          >
            {shortLabel(d.date)}
          </button>
        ))}
      </div>
      <div className={styles.calendarLegend}>
        <span><i className={`${styles.legendDot} ${styles.dayCellDone}`} /> Выполнено</span>
        <span><i className={`${styles.legendDot} ${styles.dayCellPartial}`} /> Частично</span>
        <span><i className={`${styles.legendDot} ${styles.dayCellPardoned}`} /> Помиловано</span>
        <span><i className={`${styles.legendDot} ${styles.dayCellMissed}`} /> Пропущено</span>
      </div>
      {openDay && <DayDetails day={openDay} onClose={() => setOpenDay(null)} />}
    </div>
  )
}
