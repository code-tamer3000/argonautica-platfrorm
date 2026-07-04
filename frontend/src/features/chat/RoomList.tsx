import { useMemo, useState } from 'react'
import { useRooms } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { IconChat, IconDiary, IconPin, IconPlus, IconUsers } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import type { PublicUserOut, RoomOut } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import { useNavBadges } from '../app/useNavBadges'
import { useAuth } from '../auth/AuthContext'
import { NewChatModal } from './NewChatModal'
import { NewGroupModal } from './NewGroupModal'
import { roomAvatarUrl, roomTitle } from './util'
import styles from './chat.module.css'

export type Tab = 'chats' | 'channels'

interface RoomButtonProps {
  r: RoomOut
  selectedId: number | null
  onSelect: (id: number) => void
  dmPeers: Record<number, number>
  online: number[]
  users: Map<number, PublicUserOut>
  pinned?: boolean
}

function RoomButton({ r, selectedId, onSelect, dmPeers, online, users, pinned }: RoomButtonProps) {
  const title = roomTitle(r, dmPeers, users)
  const peer = r.type === 'dm' ? (dmPeers[r.id] ?? r.peer_id) : undefined
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
          {r.type === 'channel' && !r.is_personal && !r.is_news ? '# ' : ''}
          {title}
          {pinned && <IconPin size={13} className={styles.roomPinIcon} />}
        </span>
        <span className={styles.roomSub}>{subLabel(r)}</span>
      </span>
      {r.unread_count > 0 && <span className={styles.unread}>{r.unread_count}</span>}
    </button>
  )
}

interface Props {
  selectedId: number | null
  onSelect: (id: number) => void
  /** Активная вкладка Чаты/Дневники живёт в ChatLayout — чтобы на мобиле она не
      сбрасывалась при возврате из открытого чата (RoomList там перемонтируется). */
  tab: Tab
  onTabChange: (t: Tab) => void
}

const subLabel = (r: RoomOut): string =>
  r.is_news ? 'Новостной канал' :
  r.is_personal ? 'Личный дневник' :
  r.type === 'channel' ? 'Дневник' : r.type === 'group' ? 'Группа' : 'Личный чат'

export function RoomList({ selectedId, onSelect }: Props) {
  const { data: rooms, isLoading } = useRooms()
  const users = useUsersMap()
  const { user: me } = useAuth()
  const dmPeers = useUiStore((s) => s.dmPeers)
  const online = useUiStore((s) => s.online)
  const [tab, setTab] = useState<Tab>('chats')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<'chat' | 'group' | null>(null)
  const badges = useNavBadges()

  const { dms, groups, pinnedChannels, otherChannels } = useMemo(() => {
    const list = rooms ?? []
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? list.filter((r) => roomTitle(r, dmPeers, users).toLowerCase().includes(needle))
      : list
    // Новостной канал вынесен в верхнеуровневую кнопку «Новости» (см. AppShell) —
    // из списка каналов его исключаем, чтобы не дублировать.
    const channels = filtered.filter((r) => r.type === 'channel' && !r.is_news)

    // Закреплённые сверху: собственный личный канал.
    const mine = channels.find((r) => r.is_personal && r.created_by === me?.id)
    const pinnedIds = new Set([mine?.id].filter((x): x is number => x != null))
    const pinned: RoomOut[] = []
    if (mine) pinned.push(mine)

    return {
      dms: filtered.filter((r) => r.type === 'dm'),
      groups: filtered.filter((r) => r.type === 'group'),
      pinnedChannels: pinned,
      otherChannels: channels.filter((r) => !pinnedIds.has(r.id)),
    }
  }, [rooms, q, dmPeers, users, me?.id])

  const chatsEmpty = dms.length === 0 && groups.length === 0
  const channelsEmpty = pinnedChannels.length === 0 && otherChannels.length === 0

  return (
    <aside className={styles.list}>
      <div className={styles.tabs}>
        {/* Один общий индикатор, «пробегающий» между вкладками Чаты↔Дневники.
            Вкладок ровно две (по 50%), поэтому X = 0% или 100% ширины глайдера. */}
        <span
          className={styles.tabGlider}
          style={{ transform: `translateX(${tab === 'chats' ? '0%' : '100%'})` }}
          aria-hidden
        />
        <button
          className={`${styles.tab} ${tab === 'chats' ? styles.tabActive : ''}`}
          onClick={() => setTab('chats')}
        >
          <IconChat size={16} /> Чаты
          {badges.chats > 0 && <span className={styles.tabBadge}>{badges.chats > 99 ? '99+' : badges.chats}</span>}
        </button>
        <button
          className={`${styles.tab} ${tab === 'channels' ? styles.tabActive : ''}`}
          onClick={() => setTab('channels')}
        >
          <IconDiary size={16} /> Дневники
          {badges.channels > 0 && <span className={styles.tabBadge}>{badges.channels > 99 ? '99+' : badges.channels}</span>}
        </button>
      </div>

      <div className={styles.listHead}>
        {tab === 'chats' && (
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
        )}
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

      <div key={tab} className={styles.rooms}>
        {isLoading && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner />
          </div>
        )}

        {tab === 'chats' && (
          <>
            {rooms && chatsEmpty && (
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
          </>
        )}

        {tab === 'channels' && (
          <>
            {rooms && channelsEmpty && (
              <div className="muted" style={{ padding: 16, fontSize: 14 }}>Дневников нет</div>
            )}
            {pinnedChannels.length > 0 && (
              <>
                <div className={styles.sectionHeader}>Закреплённые</div>
                {pinnedChannels.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} pinned />)}
              </>
            )}
            {otherChannels.length > 0 && (
              <>
                <div className={styles.sectionHeader}>Все дневники</div>
                {otherChannels.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} />)}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
