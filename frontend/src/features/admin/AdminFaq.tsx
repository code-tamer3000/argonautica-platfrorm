import { useState } from 'react'
import {
  useFaqItems,
  useCreateFaq,
  useUpdateFaq,
  useDeleteFaq,
} from '../../api/faq'
import type { FaqItemOut } from '../../lib/types'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { toast } from '../../stores/toast'
import styles from './admin.module.css'

interface FaqFormValues {
  question: string
  answer: string
  sort_order: string
}

interface FaqFormProps {
  initial?: FaqItemOut
  onSubmit: (values: FaqFormValues) => void
}

function FaqForm({ initial, onSubmit }: FaqFormProps) {
  const [question, setQuestion] = useState(initial?.question ?? '')
  const [answer, setAnswer] = useState(initial?.answer ?? '')
  const [sortOrder, setSortOrder] = useState(
    initial ? String(initial.sort_order) : '0',
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({ question, answer, sort_order: sortOrder })
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <label className={styles.label}>
        Вопрос
        <input
          className={styles.input}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Ответ / инструкция
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          rows={6}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Порядок (меньше — выше)
        <input
          className={styles.input}
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </label>
      <div className={styles.formActions}>
        <Button type="submit">Сохранить</Button>
      </div>
    </form>
  )
}

export function AdminFaq() {
  const { data: items = [], isLoading } = useFaqItems()
  const createFaq = useCreateFaq()
  const updateFaq = useUpdateFaq()
  const deleteFaq = useDeleteFaq()

  const [createOpen, setCreateOpen] = useState(false)
  const [editItem, setEditItem] = useState<FaqItemOut | null>(null)

  function handleCreate(values: FaqFormValues) {
    createFaq.mutate(
      {
        question: values.question,
        answer: values.answer,
        sort_order: Number(values.sort_order) || 0,
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

  function handleEdit(values: FaqFormValues) {
    if (!editItem) return
    updateFaq.mutate(
      {
        id: editItem.id,
        question: values.question,
        answer: values.answer,
        sort_order: Number(values.sort_order) || 0,
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
    if (!window.confirm('Удалить вопрос?')) return
    deleteFaq.mutate(id, {
      onSuccess: () => toast('Удалено'),
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  if (isLoading) return <div className={styles.page}><Spinner /></div>

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Частые вопросы</h1>
        <Button onClick={() => setCreateOpen(true)}>Добавить вопрос</Button>
      </div>

      {items.length === 0 ? (
        <p className={styles.mediaEmpty}>Вопросов пока нет.</p>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <div className={styles.listItem} key={item.id}>
              <div className={styles.listItemMain}>
                <span className={styles.listTitle}>{item.question}</span>
                <span className={styles.listMeta}>#{item.sort_order}</span>
              </div>
              <div className={styles.listActions}>
                <Button variant="outline" onClick={() => setEditItem(item)}>
                  Редактировать
                </Button>
                <Button variant="outline" onClick={() => handleDelete(item.id)}>
                  Удалить
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <Modal title="Новый вопрос" onClose={() => setCreateOpen(false)}>
          <FaqForm onSubmit={handleCreate} />
        </Modal>
      )}

      {editItem && (
        <Modal title="Редактировать вопрос" onClose={() => setEditItem(null)}>
          <FaqForm initial={editItem} onSubmit={handleEdit} />
        </Modal>
      )}
    </div>
  )
}
