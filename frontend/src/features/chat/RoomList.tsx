import { useMemo, useState } from 'react'
import { useRooms } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Spinner } from '../../components/Spinner'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import { NewChatModal } from './NewChatModal'
import { NewGroupModal } from './NewGroupModal'
import { roomAvatarUrl, roomTitle } from './util'
import styles from './chat.module.css'

interface Props {
  selectedId: number | null
  onSelect: (id: number) => void
}

const subLabel = (type: string): string =>
  type === 'channel' ? 'Канал' : type === 'group' ? 'Группа' : 'Личный чат'

export function RoomList({ selectedId, onSelect }: Props) {
  const { data: rooms, isLoading } = useRooms()
  const users = useUsersMap()
  const { user: me } = useAuth()
  const dmPeers = useUiStore((s) => s.dmPeers)
  const online = useUiStore((s) => s.online)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<'chat' | 'group' | null>(null)

  const filtered = useMemo(() => {
    const list = rooms ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((r) => roomTitle(r, dmPeers, users).toLowerCase().includes(needle))
  }, [rooms, q, dmPeers, users])

  return (
    <aside className={styles.list}>
      <div className={styles.listHead}>
        <div className={styles.headActions}>
          <button className={styles.headBtn} onClick={() => setModal('chat')}>
            ✏️ Новый чат
          </button>
          {me?.can_create_groups && (
            <button className={styles.headBtn} onClick={() => setModal('group')}>
              👥 Группа
            </button>
          )}
        </div>
        <input
          className={styles.search}
          placeholder="Поиск"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {modal === 'chat' && (
        <NewChatModal
          onClose={() => setModal(null)}
          onOpenDm={(id) => {
            setModal(null)
            onSelect(id)
          }}
        />
      )}
      {modal === 'group' && (
        <NewGroupModal
          onClose={() => setModal(null)}
          onCreated={(id) => {
            setModal(null)
            onSelect(id)
          }}
        />
      )}
      <div className={styles.rooms}>
        {isLoading && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner />
          </div>
        )}
        {rooms && filtered.length === 0 && (
          <div className="muted" style={{ padding: 16, fontSize: 14 }}>Чатов нет</div>
        )}
        {filtered.map((r) => {
          const title = roomTitle(r, dmPeers, users)
          const peer = r.type === 'dm' ? dmPeers[r.id] : undefined
          const isOnline = peer != null && online.includes(peer)
          return (
            <button
              key={r.id}
              className={`${styles.roomItem} ${selectedId === r.id ? styles.roomActive : ''}`}
              onClick={() => onSelect(r.id)}
            >
              <span className={styles.roomAvatarWrap}>
                <Avatar name={title} url={roomAvatarUrl(r, dmPeers, users)} square={r.type !== 'dm'} />
                {isOnline && <span className={styles.presenceDot} />}
              </span>
              <span className={styles.roomMain}>
                <span className={styles.roomTitle}>
                  {r.type === 'channel' ? '# ' : ''}
                  {title}
                </span>
                <span className={styles.roomSub}>{subLabel(r.type)}</span>
              </span>
              {r.unread_count > 0 && <span className={styles.unread}>{r.unread_count}</span>}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
