import { useState } from 'react'
import {
  useCreateKbCategory,
  useDeleteKbCategory,
  useKbCategories,
  useUpdateKbCategory,
} from '../../api/kb'
import { toast } from '../../stores/toast'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
// Перенесено из features/admin/AdminKb — стили намеренно остаются админскими.
import styles from '../admin/admin.module.css'

/** Управление плоскими категориями KB: создать, переименовать, удалить. */
export function CategoryManager({ onClose }: { onClose: () => void }) {
  const { data: categories = [] } = useKbCategories()
  const createCat = useCreateKbCategory()
  const updateCat = useUpdateKbCategory()
  const deleteCat = useDeleteKbCategory()
  const [newTitle, setNewTitle] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)

  function onError(err: unknown) {
    toast(err instanceof Error ? err.message : 'Ошибка', 'error')
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    createCat.mutate(
      { title },
      { onSuccess: () => setNewTitle(''), onError },
    )
  }

  function rename(id: number, current: string) {
    const title = window.prompt('Новое название категории', current)?.trim()
    if (!title || title === current) return
    updateCat.mutate({ id, title }, { onError })
  }

  function confirmRemove() {
    if (deleteId == null) return
    deleteCat.mutate(deleteId, {
      onSuccess: () => {
        toast('Категория удалена')
        setDeleteId(null)
      },
      onError,
    })
  }

  return (
    <Modal title="Категории" onClose={onClose} closeOnBackdrop={false}>
      <form onSubmit={handleAdd} className={styles.form}>
        <label className={styles.label}>
          Новая категория
          <input
            className={styles.input}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Название"
          />
        </label>
        <div className={styles.formActions}>
          <Button type="submit" disabled={!newTitle.trim()}>
            Добавить
          </Button>
        </div>
      </form>

      <div className={styles.list}>
        {categories.length === 0 && <p className="muted">Категорий пока нет</p>}
        {categories.map((cat) => (
          <div className={styles.listItem} key={cat.id}>
            <div className={styles.listItemMain}>
              <span className={styles.listTitle}>{cat.title}</span>
            </div>
            <div className={styles.listActions}>
              <Button variant="outline" onClick={() => rename(cat.id, cat.title)}>
                Переименовать
              </Button>
              <Button variant="outline" onClick={() => setDeleteId(cat.id)}>
                Удалить
              </Button>
            </div>
          </div>
        ))}
      </div>

      {deleteId != null && (
        <ConfirmDialog
          title="Удалить категорию?"
          text="Материалы останутся без категории."
          onConfirm={confirmRemove}
          onClose={() => setDeleteId(null)}
        />
      )}
    </Modal>
  )
}
