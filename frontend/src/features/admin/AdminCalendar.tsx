import { useState } from 'react'
import {
  useCalendarEvents,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
} from '../../api/calendar'
import type { CalendarEventOut } from '../../lib/types'
import { useRooms } from '../../api/rooms'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import styles from './admin.module.css'

interface EventFormValues {
  title: string
  description: string
  starts_at: string
  ends_at: string
  all_day: boolean
  room_id: string
}

function toDatetimeLocal(iso: string): string {
  return iso.slice(0, 16)
}

function formatDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

interface EventFormProps {
  initial?: CalendarEventOut
  rooms: { id: number; name: string | null; type: string }[]
  onSubmit: (values: EventFormValues) => void
}

function EventForm({ initial, rooms, onSubmit }: EventFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [startsAt, setStartsAt] = useState(
    initial ? toDatetimeLocal(initial.starts_at) : '',
  )
  const [endsAt, setEndsAt] = useState(
    initial?.ends_at ? toDatetimeLocal(initial.ends_at) : '',
  )
  const [allDay, setAllDay] = useState(initial?.all_day ?? false)
  const [roomId, setRoomId] = useState(
    initial?.room_id != null ? String(initial.room_id) : '',
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({ title, description, starts_at: startsAt, ends_at: endsAt, all_day: allDay, room_id: roomId })
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <label className={styles.label}>
        Название
        <input
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Описание
        <textarea
          className={styles.textarea}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className={styles.label}>
        Начало
        <input
          className={styles.input}
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Конец
        <input
          className={styles.input}
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />
      </label>
      <label className={styles.checkLabel}>
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
        />
        Весь день
      </label>
      <label className={styles.label}>
        Комната
        <select
          className={styles.input}
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        >
          <option value="">— нет комнаты —</option>
          {rooms.map((r) => (
            <option key={r.id} value={String(r.id)}>
              {r.name ?? `#${r.id} (${r.type})`}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.formActions}>
        <Button type="submit">Сохранить</Button>
      </div>
    </form>
  )
}

export function AdminCalendar() {
  const { data: events = [] } = useCalendarEvents()
  const { data: rooms = [] } = useRooms()
  const createEvent = useCreateCalendarEvent()
  const updateEvent = useUpdateCalendarEvent()
  const deleteEvent = useDeleteCalendarEvent()

  const [createOpen, setCreateOpen] = useState(false)
  const [editEvent, setEditEvent] = useState<CalendarEventOut | null>(null)

  function handleCreate(values: EventFormValues) {
    createEvent.mutate(
      {
        title: values.title,
        description: values.description || null,
        starts_at: new Date(values.starts_at).toISOString(),
        ends_at: values.ends_at ? new Date(values.ends_at).toISOString() : null,
        all_day: values.all_day,
        room_id: values.room_id ? Number(values.room_id) : null,
      },
      {
        onSuccess: () => {
          toast('Создано')
          setCreateOpen(false)
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleEdit(values: EventFormValues) {
    if (!editEvent) return
    updateEvent.mutate(
      {
        id: editEvent.id,
        title: values.title,
        description: values.description || null,
        starts_at: new Date(values.starts_at).toISOString(),
        ends_at: values.ends_at ? new Date(values.ends_at).toISOString() : null,
        all_day: values.all_day,
      },
      {
        onSuccess: () => {
          toast('Сохранено')
          setEditEvent(null)
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleDelete(id: number) {
    if (!window.confirm('Удалить событие?')) return
    deleteEvent.mutate(id, {
      onSuccess: () => toast('Удалено'),
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Календарь</h1>
        <Button onClick={() => setCreateOpen(true)}>Создать событие</Button>
      </div>

      <div className={styles.list}>
        {events.map((event) => (
          <div className={styles.listItem} key={event.id}>
            <div className={styles.listItemMain}>
              <span className={styles.listTitle}>{event.title}</span>
              <span className={styles.listMeta}>{formatDatetime(event.starts_at)}</span>
              {event.description && (
                <span className={styles.listDescription}>
                  {event.description.length > 80
                    ? event.description.slice(0, 80) + '…'
                    : event.description}
                </span>
              )}
            </div>
            <div className={styles.listActions}>
              <Button variant="outline" onClick={() => setEditEvent(event)}>
                Редактировать
              </Button>
              <Button variant="outline" onClick={() => handleDelete(event.id)}>
                Удалить
              </Button>
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <Modal title="Создать событие" onClose={() => setCreateOpen(false)}>
          <EventForm rooms={rooms} onSubmit={handleCreate} />
        </Modal>
      )}

      {editEvent && (
        <Modal title="Редактировать событие" onClose={() => setEditEvent(null)}>
          <EventForm rooms={rooms} initial={editEvent} onSubmit={handleEdit} />
        </Modal>
      )}
    </div>
  )
}
