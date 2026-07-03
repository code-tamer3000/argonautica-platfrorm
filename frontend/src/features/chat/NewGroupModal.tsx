import { useMemo, useState } from 'react'
import { addRoomMember, useCreateRoom } from '../../api/rooms'
import { useUsers } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { toast } from '../../stores/toast'
import { useAuth } from '../auth/AuthContext'
import styles from './chat.module.css'

interface Props {
  onClose: () => void
  onCreated: (roomId: number) => void
}

export function NewGroupModal({ onClose, onCreated }: Props) {
  const { data: users, isLoading } = useUsers()
  const { user: me } = useAuth()
  const createRoom = useCreateRoom()
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const filtered = useMemo(() => {
    const list = (users ?? []).filter((u) => u.id !== me?.id)
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter(
      (u) =>
        u.display_name.toLowerCase().includes(needle) ||
        u.username.toLowerCase().includes(needle),
    )
  }, [users, me?.id, q])

  // Все ли отфильтрованные пользователи уже выбраны.
  const allSelected =
    filtered.length > 0 && filtered.every((u) => selected.has(u.id))

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const u of filtered) next.delete(u.id)
      } else {
        for (const u of filtered) next.add(u.id)
      }
      return next
    })
  }

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast('Введите название группы', 'error')
      return
    }
    setSubmitting(true)
    try {
      const room = await createRoom.mutateAsync({ type: 'group', name: trimmed })
      // Добавляем выбранных участников (создатель уже owner на бэке).
      for (const userId of selected) {
        try {
          await addRoomMember(room.id, userId)
        } catch {
          toast(`Не удалось добавить участника #${userId}`, 'error')
        }
      }
      onCreated(room.id)
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось создать группу', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Новая группа" onClose={onClose}>
      <input
        className={styles.search}
        placeholder="Название группы"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        autoFocus
      />

      <div className={styles.groupHead}>
        <span className={styles.groupHint}>Участники</span>
        <button
          type="button"
          className={styles.selectAllBtn}
          onClick={toggleAll}
          disabled={filtered.length === 0}
        >
          {allSelected ? 'Снять выбор' : 'Выбрать всех'}
        </button>
      </div>

      <input
        className={styles.search}
        placeholder="Поиск участника"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className={styles.userList}>
        {isLoading && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner />
          </div>
        )}
        {users && filtered.length === 0 && (
          <div className={styles.emptyUsers}>Никого не найдено</div>
        )}
        {filtered.map((u) => {
          const on = selected.has(u.id)
          return (
            <button
              key={u.id}
              type="button"
              className={`${styles.userRow} ${on ? styles.userRowSelected : ''}`}
              onClick={() => toggle(u.id)}
              aria-pressed={on}
            >
              <Avatar name={u.display_name} url={u.avatar_url} size={36} />
              <div className={styles.userRowMain}>
                <div className={styles.userRowName}>{u.display_name}</div>
                <div className={styles.userRowSub}>@{u.username}</div>
              </div>
              <span className={`${styles.userCheck} ${on ? styles.userCheckOn : ''}`}>
                {on && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 12.5l4.5 4.5L19 7"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className={styles.modalActions}>
        <span className={styles.selectedCount}>
          Выбрано: <b>{selected.size}</b>
        </span>
        <Button variant="gold" onClick={handleCreate} disabled={submitting}>
          {submitting ? <Spinner size={16} /> : 'Создать'}
        </Button>
      </div>
    </Modal>
  )
}
