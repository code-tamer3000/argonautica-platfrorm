import { useMemo, useState } from 'react'
import { useRooms } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { IconPlus, IconUsers } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import type { PublicUserOut, RoomOut } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import { NewChatModal } from './NewChatModal'
import { NewGroupModal } from './NewGroupModal'
import { roomAvatarUrl, roomTitle } from './util'
import styles from './chat.module.css'

interface RoomButtonProps {
  r: RoomOut
  selectedId: number | null
  onSelect: (id: number) => void
  dmPeers: Record<number, number>
  online: number[]
  users: Map<number, PublicUserOut>
}

function RoomButton({ r, selectedId, onSelect, dmPeers, online, users }: RoomButtonProps) {
  const title = roomTitle(r, dmPeers, users)
  const peer = r.type === 'dm' ? dmPeers[r.id] : undefined
  const isOnline = peer != null && online.includes(peer)
  return (
    <button
      className={`${styles.roomItem} ${selectedId === r.id ? styles.roomActive : ''}`}
      onClick={() => onSelect(r.id)}
    >
      <span className={styles.roomAvatarWrap}>
        <Avatar name={title} url={roomAvatarUrl(r, dmPeers, users)} square={r.type !== 'dm'} />
        {isOnline && <span className={styles.presenceDot} />}
      </span>
      <span className={styles.roomMain}>
        <span className={styles.roomTitle}>
          {r.type === 'channel' && !r.is_personal ? '# ' : ''}
          {title}
        </span>
        <span className={styles.roomSub}>{subLabel(r.type, r.is_personal)}</span>
      </span>
      {r.unread_count > 0 && <span className={styles.unread}>{r.unread_count}</span>}
    </button>
  )
}

interface Props {
  selectedId: number | null
  onSelect: (id: number) => void
}

const subLabel = (type: string, isPersonal = false): string =>
  isPersonal ? 'Личный канал' :
  type === 'channel' ? 'Канал' : type === 'group' ? 'Группа' : 'Личный чат'

export function RoomList({ selectedId, onSelect }: Props) {
  const { data: rooms, isLoading } = useRooms()
  const users = useUsersMap()
  const { user: me } = useAuth()
  const dmPeers = useUiStore((s) => s.dmPeers)
  const online = useUiStore((s) => s.online)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<'chat' | 'group' | null>(null)

  const { dms, groups, channels } = useMemo(() => {
    const list = rooms ?? []
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? list.filter((r) => roomTitle(r, dmPeers, users).toLowerCase().includes(needle))
      : list
    return {
      dms: filtered.filter((r) => r.type === 'dm'),
      groups: filtered.filter((r) => r.type === 'group'),
      channels: filtered.filter((r) => r.type === 'channel'),
    }
  }, [rooms, q, dmPeers, users])

  return (
    <aside className={styles.list}>
      <div className={styles.listHead}>
        <div className={styles.headActions}>
          <button className={styles.headBtn} onClick={() => setModal('chat')}>
            <IconPlus size={16} /> Новый чат
          </button>
          {me?.can_create_groups && (
            <button className={styles.headBtn} onClick={() => setModal('group')}>
              <IconUsers size={16} /> Группа
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
        {rooms && dms.length === 0 && groups.length === 0 && channels.length === 0 && (
          <div className="muted" style={{ padding: 16, fontSize: 14 }}>Чатов нет</div>
        )}
        {dms.length > 0 && (
          <>
            <div className={styles.sectionHeader}>Чаты</div>
            {dms.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} />)}
          </>
        )}
        {groups.length > 0 && (
          <>
            <div className={styles.sectionHeader}>Группы</div>
            {groups.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} />)}
          </>
        )}
        {channels.length > 0 && (
          <>
            <div className={styles.sectionHeader}>Каналы</div>
            {channels.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} />)}
          </>
        )}
      </div>
    </aside>
  )
}
