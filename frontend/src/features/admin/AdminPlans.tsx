import { useState } from 'react'
import {
  useAdminPlans,
  useCreatePlan,
  useUpdatePlan,
  useDeletePlan,
} from '../../api/plans'
import type { PlanOut } from '../../lib/types'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import { toast } from '../../stores/toast'
import styles from './admin.module.css'

interface PlanFormValues {
  name: string
  price: string
  description: string
  is_active: boolean
}

interface PlanFormProps {
  initial?: PlanOut
  onSubmit: (values: PlanFormValues) => void
}

function PlanForm({ initial, onSubmit }: PlanFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({ name, price, description, is_active: isActive })
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <label className={styles.label}>
        Название
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Цена, ₽
        <input
          className={styles.input}
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Описание (что участник видит по кнопке «Подробнее»)
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className={styles.label}>
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />{' '}
        Активен (виден в боте)
      </label>
      <div className={styles.formActions}>
        <Button type="submit">Сохранить</Button>
      </div>
    </form>
  )
}

export function AdminPlans() {
  const { data: plans = [], isLoading } = useAdminPlans()
  const createPlan = useCreatePlan()
  const updatePlan = useUpdatePlan()
  const deletePlan = useDeletePlan()

  const [createOpen, setCreateOpen] = useState(false)
  const [editItem, setEditItem] = useState<PlanOut | null>(null)

  function handleCreate(values: PlanFormValues) {
    createPlan.mutate(
      {
        name: values.name,
        price: Number(values.price) || 0,
        description: values.description,
        is_active: values.is_active,
      },
      {
        onSuccess: () => {
          toast('Тариф создан')
          setCreateOpen(false)
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleEdit(values: PlanFormValues) {
    if (!editItem) return
    updatePlan.mutate(
      {
        id: editItem.id,
        name: values.name,
        price: Number(values.price) || 0,
        description: values.description,
        is_active: values.is_active,
      },
      {
        onSuccess: () => {
          toast('Сохранено')
          setEditItem(null)
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleDelete(id: number) {
    if (!window.confirm('Удалить тариф?')) return
    deletePlan.mutate(id, {
      onSuccess: () => toast('Удалено'),
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  if (isLoading) return <div className={styles.page}><Spinner /></div>

  return (
    <div className={styles.page}>
      <PageHeader title="Тарифы">
        <Button onClick={() => setCreateOpen(true)}>Добавить тариф</Button>
      </PageHeader>

      {plans.length === 0 ? (
        <p className={styles.mediaEmpty}>Тарифов пока нет.</p>
      ) : (
        <div className={styles.list}>
          {plans.map((plan) => (
            <div className={styles.listItem} key={plan.id}>
              <div className={styles.listItemMain}>
                <span className={styles.listTitle}>
                  {plan.name} — {plan.price.toLocaleString('ru-RU')} ₽
                  {!plan.is_active && ' (скрыт)'}
                </span>
                <span className={styles.listMeta}>#{plan.id}</span>
              </div>
              <div className={styles.listActions}>
                <Button variant="outline" onClick={() => setEditItem(plan)}>
                  Редактировать
                </Button>
                <Button variant="outline" onClick={() => handleDelete(plan.id)}>
                  Удалить
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <Modal title="Новый тариф" onClose={() => setCreateOpen(false)}>
          <PlanForm onSubmit={handleCreate} />
        </Modal>
      )}

      {editItem && (
        <Modal title="Редактировать тариф" onClose={() => setEditItem(null)}>
          <PlanForm initial={editItem} onSubmit={handleEdit} />
        </Modal>
      )}
    </div>
  )
}
