import { useState } from 'react'
import {
  useCalendarEvents,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
} from '../../api/calendar'
import type { CalendarEventOut } from '../../lib/types'
import { dateTimeMsk } from '../../lib/format'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { PageHeader } from '../../components/PageHeader'
import { EventForm, type EventFormValues, mskLocalToIso } from './EventForm'
import styles from './admin.module.css'

function formatDatetime(iso: string): string {
  try {
    return dateTimeMsk(iso)
  } catch {
    return iso
  }
}

export function AdminCalendar() {
  const { data: events = [] } = useCalendarEvents()
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
        starts_at: mskLocalToIso(values.starts_at),
        ends_at: values.ends_at ? mskLocalToIso(values.ends_at) : null,
        all_day: values.all_day,
        intake_id: values.intake_id,
        plan_ids: values.plan_ids,
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
        starts_at: mskLocalToIso(values.starts_at),
        ends_at: values.ends_at ? mskLocalToIso(values.ends_at) : null,
        all_day: values.all_day,
        intake_id: values.intake_id,
        plan_ids: values.plan_ids,
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
      <PageHeader title="Календарь">
        <Button onClick={() => setCreateOpen(true)}>Создать событие</Button>
      </PageHeader>

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
        <Modal title="Создать событие" onClose={() => setCreateOpen(false)} closeOnBackdrop={false}>
          <EventForm onSubmit={handleCreate} />
        </Modal>
      )}

      {editEvent && (
        <Modal title="Редактировать событие" onClose={() => setEditEvent(null)} closeOnBackdrop={false}>
          <EventForm initial={editEvent} onSubmit={handleEdit} />
        </Modal>
      )}
    </div>
  )
}
