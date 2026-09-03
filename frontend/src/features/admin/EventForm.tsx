import { useState } from 'react'
import { useAdminIntakes } from '../../api/admin'
import { useAdminPlans } from '../../api/plans'
import type { CalendarEventOut } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import { Button } from '../../components/Button'
import styles from './admin.module.css'

export interface EventFormValues {
  title: string
  description: string
  starts_at: string
  ends_at: string
  all_day: boolean
  intake_id: number | null
  plan_ids: number[]
}

// Москва фиксированно UTC+3 (без переходов на летнее время с 2014), поэтому
// конверсии МСК↔UTC делаем простым сдвигом на 3 часа.
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

// UTC ISO → строка для <input type="datetime-local"> в московском времени.
export function toDatetimeLocalMsk(iso: string): string {
  const msk = new Date(new Date(iso).getTime() + MSK_OFFSET_MS)
  return msk.toISOString().slice(0, 16)
}

// Значение datetime-local трактуем как МСК → UTC ISO для отправки на бэкенд.
export function mskLocalToIso(local: string): string {
  const asUtc = new Date(`${local}Z`) // парсим введённые цифры как если бы это был UTC
  return new Date(asUtc.getTime() - MSK_OFFSET_MS).toISOString()
}

interface EventFormProps {
  initial?: CalendarEventOut
  // Начальное значение «Начало (МСК)» для нового события (напр. выбранный день
  // в календаре), формат datetime-local. Игнорируется при редактировании.
  defaultStartsAt?: string
  onSubmit: (values: EventFormValues) => void
}

export function EventForm({ initial, defaultStartsAt, onSubmit }: EventFormProps) {
  const editing = !!initial
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [startsAt, setStartsAt] = useState(
    initial ? toDatetimeLocalMsk(initial.starts_at) : (defaultStartsAt ?? ''),
  )
  const [endsAt, setEndsAt] = useState(
    initial?.ends_at ? toDatetimeLocalMsk(initial.ends_at) : '',
  )
  const [allDay, setAllDay] = useState(initial?.all_day ?? false)
  // Новое событие по умолчанию берёт «текущий поток» админа (ARG-104); при
  // редактировании — сохранённое значение как есть, даже если это null.
  const adminCurrentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const [intakeId, setIntakeId] = useState<number | null>(
    editing ? (initial?.intake_id ?? null) : adminCurrentIntakeId,
  )
  const [planIds, setPlanIds] = useState<number[]>(initial?.plan_ids ?? [])
  const { data: intakes = [] } = useAdminIntakes()
  const { data: plans = [] } = useAdminPlans()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      title,
      description,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: allDay,
      intake_id: intakeId,
      plan_ids: planIds,
    })
  }

  function togglePlan(planId: number) {
    setPlanIds((prev) =>
      prev.includes(planId) ? prev.filter((id) => id !== planId) : [...prev, planId],
    )
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
        Начало (МСК)
        <input
          className={styles.input}
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Конец (МСК)
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
        Набор
        <select
          className={styles.input}
          value={intakeId ?? ''}
          onChange={(e) => setIntakeId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Общий для всех потоков</option>
          {intakes.map((intake) => (
            <option key={intake.id} value={intake.id}>
              {intake.starts_on} – {intake.ends_on}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.label}>
        Тарифы
        {plans.length === 0 ? (
          <p className={styles.mediaEmpty}>Тарифов пока нет</p>
        ) : (
          <div className={styles.list}>
            {plans.map((plan) => (
              <label key={plan.id} className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={planIds.includes(plan.id)}
                  onChange={() => togglePlan(plan.id)}
                />
                {plan.name}
              </label>
            ))}
          </div>
        )}
        <p className={styles.mediaEmpty}>Ничего не выбрано — доступен всем тарифам потока</p>
      </div>
      <div className={styles.formActions}>
        <Button type="submit">Сохранить</Button>
      </div>
    </form>
  )
}
