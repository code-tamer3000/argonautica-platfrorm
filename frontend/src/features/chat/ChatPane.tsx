import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMarkRead, useMessages } from '../../api/messages'
import { useRooms } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { IconBack, IconPin, IconUsers } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import type { MessageOut } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import { ChannelCalendar } from './ChannelCalendar'
import { Composer } from './Composer'
import { DailyJournalForm } from './DailyJournalForm'
import { MembersDrawer } from './MembersDrawer'
import { MessageList, type MessageListHandle } from './MessageList'
import { PinsBar } from './PinsBar'
import { PinsDrawer } from './PinsDrawer'
import { ThreadPanel } from './ThreadPanel'
import { TypingIndicator } from './TypingIndicator'
import { UserProfileModal } from './UserProfileModal'
import { roomAvatarUrl, roomTitle } from './util'
import styles from './chat.module.css'

const subLabel = (type: string, isPersonal = false, isNews = false): string =>
  isNews ? 'Новостной канал' :
  isPersonal ? 'Личный канал' :
  type === 'channel' ? 'Канал' : type === 'group' ? 'Группа' : 'Личный чат'

export function ChatPane({ roomId, onOpenRoom, onBack }: { roomId: number; onOpenRoom?: (id: number) => void; onBack?: () => void }) {
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
  const [showCalendar, setShowCalendar] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [selectedMsgId, setSelectedMsgId] = useState<number | null>(null)
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null)
  const messageListRef = useRef<MessageListHandle>(null)

  // Сбросить панели при смене комнаты.
  useEffect(() => {
    setReplyTo(null)
    setEditingId(null)
    setThreadRootId(null)
    setShowPins(false)
    setShowMembers(false)
    setShowCalendar(false)
    setShowProfile(false)
    setSelectedMsgId(null)
    setHighlightedMsgId(null)
  }, [roomId])

  // Вывести пира личного чата из сообщений (API не отдаёт состав dm).
  useEffect(() => {
    if (room?.type === 'dm' && user) {
      const other = messages.find((m) => m.sender_id !== user.id)
      if (other) setDmPeer(roomId, other.sender_id)
    }
  }, [room?.type, messages, user, roomId, setDmPeer])

  // Отметить прочитанным только когда пользователь внизу ленты.
  const lastId = messages.length ? messages[messages.length - 1].id : 0
  const lastReadRef = useRef(0)
  const markReadRef = useRef(markRead)
  markReadRef.current = markRead

  const tryMarkRead = useCallback(() => {
    if (!lastId) return
    if (lastId <= lastReadRef.current) return
    if (!messageListRef.current?.isAtBottom()) return
    lastReadRef.current = lastId
    markReadRef.current.mutate(lastId)
  }, [lastId])

  useEffect(() => { tryMarkRead() }, [tryMarkRead])

  function navigateToMessage(msgId: number) {
    const found = messageListRef.current?.scrollToMessage(msgId)
    if (!found) { setShowPins(true); return }
    setHighlightedMsgId(msgId)
    setTimeout(() => setHighlightedMsgId(null), 2000)
  }

  if (!room) {
    return (
      <div className="center grow">
        <Spinner />
      </div>
    )
  }

  const title = roomTitle(room, dmPeers, users)
  const peerId = room.type === 'dm' ? (dmPeers[roomId] ?? room.peer_id) : undefined
  const peer = peerId != null ? users.get(peerId) : undefined

  function openHeaderInfo() {
    if (room?.type === 'dm') {
      if (peer) setShowProfile(true)
    } else if (room?.type === 'group') {
      setShowMembers(true)
    } else if (room?.is_personal) {
      setShowCalendar((v) => !v)
    }
  }

  return (
    <>
      <header className={styles.header}>
        {onBack && (
          <button className={styles.backBtn} onClick={onBack} title="Назад" aria-label="Назад">
            <IconBack size={22} />
          </button>
        )}
        <button
          className={styles.headerInfo}
          onClick={openHeaderInfo}
          title={
            room.type === 'dm' ? 'Открыть профиль' :
            room.type === 'group' ? 'Участники' :
            room.is_personal ? (showCalendar ? 'Свернуть календарь' : 'Развернуть календарь') :
            undefined
          }
        >
          <Avatar name={title} url={roomAvatarUrl(room, dmPeers, users)} square={room.type !== 'dm'} size={40} />
          <div className={styles.headerInfoText}>
            <div className={styles.headerTitle}>
              {room.type === 'channel' ? '# ' : ''}
              {title}
            </div>
            <div className={styles.headerSub}>{subLabel(room.type, room.is_personal, room.is_news)}</div>
          </div>
        </button>
        {room.type !== 'channel' && (
          <div className={styles.headerActions}>
            <button className={styles.headerIconBtn} onClick={() => setShowPins(v => !v)} title="Закреплённые" aria-label="Закреплённые">
              <IconPin size={20} />
            </button>
            {room.type !== 'dm' && (
              <button className={styles.headerIconBtn} onClick={() => setShowMembers(v => !v)} title="Участники" aria-label="Участники">
                <IconUsers size={20} />
              </button>
            )}
          </div>
        )}
      </header>
      {room.type !== 'channel' && (
        <PinsBar roomId={roomId} onOpenList={() => setShowPins(true)} onNavigate={navigateToMessage} />
      )}
      {room.is_personal && showCalendar && <ChannelCalendar roomId={roomId} />}
      {room.is_personal && room.created_by === user?.id && (
        <DailyJournalForm roomId={roomId} userId={user.id} />
      )}
      <MessageList
        ref={messageListRef}
        messages={messages}
        hasMore={!!query.hasNextPage}
        loadMore={() => void query.fetchNextPage()}
        loading={query.isFetchingNextPage}
        users={users}
        editingId={editingId}
        selectedMsgId={selectedMsgId}
        highlightedMsgId={highlightedMsgId}
        onReply={(msg) => setReplyTo(msg)}
        onEdit={(msg) => setEditingId(msg.id)}
        onClearEdit={() => setEditingId(null)}
        onOpenThread={(rootId) => setThreadRootId(rootId)}
        onSelectMsg={setSelectedMsgId}
        onAtBottomChange={(bottom) => { if (bottom) tryMarkRead() }}
      />
      <TypingIndicator roomId={roomId} users={users} />
      {/* Верхнеуровневый ввод: в чужом личном канале нельзя писать вообще;
          в новостном — только админ. Комментировать можно через треды. */}
      {(!room.is_personal || room.created_by === user?.id) &&
        (!room.is_news || user?.role === 'admin') && (
        <Composer roomId={roomId} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      )}
      {threadRootId != null && (
        <ThreadPanel roomId={roomId} rootId={threadRootId} onClose={() => setThreadRootId(null)} />
      )}
      {showPins && (
        <PinsDrawer roomId={roomId} onClose={() => setShowPins(false)} onNavigate={navigateToMessage} />
      )}
      {showMembers && (
        <MembersDrawer
          roomId={roomId}
          onClose={() => setShowMembers(false)}
          onOpenDm={onOpenRoom}
        />
      )}
      {showProfile && peer && (
        <UserProfileModal
          profile={peer}
          onClose={() => setShowProfile(false)}
          onOpenDm={(id) => {
            setShowProfile(false)
            onOpenRoom?.(id)
          }}
        />
      )}
    </>
  )
}
