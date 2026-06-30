import { useEffect, useMemo, useRef, useState } from 'react'
import { useMarkRead, useMessages } from '../../api/messages'
import { useRooms } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Spinner } from '../../components/Spinner'
import type { MessageOut } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import { Composer } from './Composer'
import { MembersDrawer } from './MembersDrawer'
import { MessageList } from './MessageList'
import { PinsDrawer } from './PinsDrawer'
import { ThreadPanel } from './ThreadPanel'
import { TypingIndicator } from './TypingIndicator'
import { roomAvatarUrl, roomTitle } from './util'
import styles from './chat.module.css'

const subLabel = (type: string): string =>
  type === 'channel' ? 'Канал' : type === 'group' ? 'Группа' : 'Личный чат'

export function ChatPane({ roomId, onOpenRoom }: { roomId: number; onOpenRoom?: (id: number) => void }) {
  const { user } = useAuth()
  const { data: rooms } = useRooms()
  const room = rooms?.find((r) => r.id === roomId)
  const users = useUsersMap()
  const dmPeers = useUiStore((s) => s.dmPeers)
  const setDmPeer = useUiStore((s) => s.setDmPeer)

  const query = useMessages(roomId)
  const markRead = useMarkRead(roomId)
  const messages = useMemo(
    () => (query.data ? query.data.pages.flat().slice().reverse() : []),
    [query.data],
  )

  const [replyTo, setReplyTo] = useState<MessageOut | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [threadRootId, setThreadRootId] = useState<number | null>(null)
  const [showPins, setShowPins] = useState(false)
  const [showMembers, setShowMembers] = useState(false)

  // Сбросить панели при смене комнаты.
  useEffect(() => {
    setReplyTo(null)
    setEditingId(null)
    setThreadRootId(null)
    setShowPins(false)
    setShowMembers(false)
  }, [roomId])

  // Вывести пира личного чата из сообщений (API не отдаёт состав dm).
  useEffect(() => {
    if (room?.type === 'dm' && user) {
      const other = messages.find((m) => m.sender_id !== user.id)
      if (other) setDmPeer(roomId, other.sender_id)
    }
  }, [room?.type, messages, user, roomId, setDmPeer])

  // Отметить прочитанным до последнего сообщения.
  const lastId = messages.length ? messages[messages.length - 1].id : 0
  const lastReadRef = useRef(0)
  const markReadRef = useRef(markRead)
  markReadRef.current = markRead
  useEffect(() => {
    if (lastId && lastId !== lastReadRef.current) {
      lastReadRef.current = lastId
      markReadRef.current.mutate(lastId)
    }
  }, [lastId])

  if (!room) {
    return (
      <div className="center grow">
        <Spinner />
      </div>
    )
  }

  const title = roomTitle(room, dmPeers, users)
  return (
    <>
      <header className={styles.header}>
        <Avatar name={title} url={roomAvatarUrl(room, dmPeers, users)} square={room.type !== 'dm'} size={40} />
        <div>
          <div className={styles.headerTitle}>
            {room.type === 'channel' ? '# ' : ''}
            {title}
          </div>
          <div className={styles.headerSub}>{subLabel(room.type)}</div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.actionBtn} onClick={() => setShowPins(v => !v)} title="Закреплённые">📌</button>
          {room.type !== 'dm' && (
            <button className={styles.actionBtn} onClick={() => setShowMembers(v => !v)} title="Участники">👥</button>
          )}
        </div>
      </header>
      <MessageList
        messages={messages}
        hasMore={!!query.hasNextPage}
        loadMore={() => void query.fetchNextPage()}
        loading={query.isFetchingNextPage}
        users={users}
        editingId={editingId}
        onReply={(msg) => setReplyTo(msg)}
        onEdit={(msg) => setEditingId(msg.id)}
        onClearEdit={() => setEditingId(null)}
        onOpenThread={(rootId) => setThreadRootId(rootId)}
      />
      <TypingIndicator roomId={roomId} users={users} />
      <Composer roomId={roomId} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      {threadRootId != null && (
        <ThreadPanel roomId={roomId} rootId={threadRootId} onClose={() => setThreadRootId(null)} />
      )}
      {showPins && (
        <PinsDrawer roomId={roomId} onClose={() => setShowPins(false)} />
      )}
      {showMembers && (
        <MembersDrawer
          roomId={roomId}
          onClose={() => setShowMembers(false)}
          onOpenDm={onOpenRoom}
        />
      )}
    </>
  )
}
