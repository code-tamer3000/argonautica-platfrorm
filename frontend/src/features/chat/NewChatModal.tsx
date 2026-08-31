import { useMemo, useState } from 'react'
import { useContacts } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { groupPreOrdered } from '../../lib/planGroups'
import type { PublicUserOut } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import { UserProfileModal } from './UserProfileModal'
import styles from './chat.module.css'

interface Props {
  onClose: () => void
  onOpenDm: (roomId: number) => void
}

export function NewChatModal({ onClose, onOpenDm }: Props) {
  const { user: me } = useAuth()
  // Админ листает контакты выбранного потока (сессионный фильтр AdminLayout, не
  // новое ограничение) — участнику сервер параметр молча игнорирует (ARG-110).
  const adminCurrentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const { data: users, isLoading } = useContacts(
    me?.role === 'admin' ? adminCurrentIntakeId : undefined,
  )
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<PublicUserOut | null>(null)

  const filtered = useMemo(() => {
    const list = users ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter(
      (u) =>
        u.display_name.toLowerCase().includes(needle) ||
        u.username.toLowerCase().includes(needle),
    )
  }, [users, q])

  // Секции по тарифу (дешёвый → дорогой), в порядке, который уже отдал сервер —
  // поиск разбивает список на подмножество, но не ломает соседство/порядок.
  const groups = useMemo(
    () => groupPreOrdered(filtered, (u) => ({ id: u.plan_id, name: u.plan_name })),
    [filtered],
  )

  if (picked) {
    return (
      <UserProfileModal
        profile={picked}
        onClose={() => setPicked(null)}
        onOpenDm={onOpenDm}
      />
    )
  }

  return (
    <Modal title="Новый чат" onClose={onClose}>
      <input
        className={styles.search}
        placeholder="Поиск участника"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className={styles.userList}>
        {isLoading && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner />
          </div>
        )}
        {users && filtered.length === 0 && (
          <div className="muted" style={{ padding: 16, fontSize: 14 }}>
            Никого не найдено
          </div>
        )}
        {groups.map((group) => (
          <div key={group.key}>
            {groups.length > 1 && (
              <div className={styles.userSectionTitle}>{group.label}</div>
            )}
            {group.items.map((u) => (
              <button key={u.id} className={styles.userRow} onClick={() => setPicked(u)}>
                <Avatar name={u.display_name} url={u.avatar_url} size={36} />
                <div className={styles.userRowMain}>
                  <div className={styles.userRowName}>{u.display_name}</div>
                  <div className={styles.userRowSub}>@{u.username}</div>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}
