import { useMemo, useState } from 'react'
import { useUsers } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import type { PublicUserOut } from '../../lib/types'
import { useAuth } from '../auth/AuthContext'
import { UserProfileModal } from './UserProfileModal'
import styles from './chat.module.css'

interface Props {
  onClose: () => void
  onOpenDm: (roomId: number) => void
}

export function NewChatModal({ onClose, onOpenDm }: Props) {
  const { data: users, isLoading } = useUsers()
  const { user: me } = useAuth()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<PublicUserOut | null>(null)

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
        {filtered.map((u) => (
          <button key={u.id} className={styles.userRow} onClick={() => setPicked(u)}>
            <Avatar name={u.display_name} url={u.avatar_url} size={36} />
            <div className={styles.userRowMain}>
              <div className={styles.userRowName}>{u.display_name}</div>
              <div className={styles.userRowSub}>@{u.username}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  )
}
