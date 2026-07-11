import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMarkRead, useMessages } from '../../api/messages'
import { useRooms } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { IconBack, IconPin, IconUsers } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import type { MessageOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import { ChannelCalendar } from './ChannelCalendar'
import { Composer } from './Composer'
import { DailyJournalForm } from './DailyJournalForm'
import { MembersDrawer } from './MembersDrawer'
import { MessageActionsMenu } from './MessageActionsMenu'
import { MessageList, type MessageListHandle } from './MessageList'
import { useMessageMenu } from './useMessageMenu'
import { PinsBar } from './PinsBar'
import { PinsDrawer } from './PinsDrawer'
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
  const setPendingRepost = useUiStore((s) => s.setPendingRepost)
  const setPendingJournal = useUiStore((s) => s.setPendingJournal)
  const pendingJournal = useUiStore((s) => s.pendingJournal)
  const journalFreeEntry = useUiStore((s) => s.journalFreeEntry)
  const setJournalFreeEntry = useUiStore((s) => s.setJournalFreeEntry)

  const query = useMessages(roomId)
  const markRead = useMarkRead(roomId)
  const messages = useMemo(
    () => (query.data ? query.data.pages.flat().slice().reverse() : []),
    [query.data],
  )

  const [editingId, setEditingId] = useState<number | null>(null)
  const [threadRootId, setThreadRootId] = useState<number | null>(null)
  const [showPins, setShowPins] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null)
  const messageListRef = useRef<MessageListHandle>(null)
  // Корень треда, который только что свернули — чтобы после закрытия плавно
  // подтянуть ленту обратно к сообщению, от которого шёл тред (см. useEffect ниже).
  const collapsedThreadRootRef = useRef<number | null>(null)

  // Право закрепления зеркалит backend `assert_can_pin` (SPEC §4.7): admin — всегда;
  // group — только владелец; dm — оба участника; channel — никому, кроме admin.
  const canPin = user?.role === 'admin' || room?.type === 'dm' ||
    (room?.type === 'group' && room.created_by === user?.id)

  // Репост: «зажимаем» сообщение и уводим админа в новостной канал — там композер
  // покажет прикреплённый репост и даст дописать комментарий перед отправкой.
  const handleRepost = (msg: MessageOut) => {
    const news = rooms?.find((r) => r.is_news)
    if (!news) { toast('Новостной канал недоступен', 'error'); return }
    setPendingRepost({ roomId, message: msg })
    onOpenRoom?.(news.id)
  }

  // Контекстное меню сообщения (общий хук для ленты и треда).
  const msgMenu = useMessageMenu({
    roomId,
    isNews: !!room?.is_news,
    canPin: !!canPin,
    onReply: (msg) => setThreadRootId(msg.id),
    onEdit: (msg) => setEditingId(msg.id),
    onRepost: handleRepost,
  })

  // Сбросить панели при смене комнаты.
  useEffect(() => {
    setEditingId(null)
    setThreadRootId(null)
    collapsedThreadRootRef.current = null
    setShowPins(false)
    setShowMembers(false)
    setShowCalendar(false)
    setShowProfile(false)
    setHighlightedMsgId(null)
    setPendingJournal(null)
    setJournalFreeEntry(null)
  }, [roomId, setPendingJournal, setJournalFreeEntry])

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

  // Свернуть тред и запомнить его корень: после того как InlineThread размонтируется
  // (высота ленты изменится), плавно подтягиваем экран обратно к сообщению-корню.
  const closeThread = useCallback(() => {
    collapsedThreadRootRef.current = threadRootId
    setThreadRootId(null)
  }, [threadRootId])

  // После сворачивания треда лента «схлопывается» — доводим её плавно к корню,
  // от которого шёл тред, чтобы на мобильном не терять место в разговоре. Ждём
  // кадр, чтобы размонтирование InlineThread успело применить новую высоту.
  useEffect(() => {
    if (threadRootId != null) return
    const rootId = collapsedThreadRootRef.current
    if (rootId == null) return
    collapsedThreadRootRef.current = null
    requestAnimationFrame(() => messageListRef.current?.scrollToMessage(rootId))
  }, [threadRootId])

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

  // Открытый инлайн-тред: его корень (для контекст-бара основного композера). Корни
  // верхнеуровневые, поэтому обычно есть в загруженной ленте; если уехал за пагинацию —
  // null, композер всё равно шлёт по threadRootId (см. Composer.threadRoot).
  const threadRoot = threadRootId != null
    ? messages.find((m) => m.id === threadRootId) ?? null
    : null

  // Свой личный дневник: композер держим скрытым, пока пользователь не выбрал
  // режим в DailyJournalForm — раздел задания или свободную запись.
  const isOwnPersonal = !!room.is_personal && room.created_by === user?.id
  const journalChosen =
    pendingJournal?.roomId === roomId || journalFreeEntry === roomId

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
      <MessageList
        key={roomId}
        ref={messageListRef}
        roomId={roomId}
        messages={messages}
        hasMore={!!query.hasNextPage}
        loadMore={() => void query.fetchNextPage()}
        loading={query.isFetchingNextPage}
        users={users}
        editingId={editingId}
        selectedMsgId={msgMenu.menu?.msg.id ?? null}
        highlightedMsgId={highlightedMsgId}
        expandedThreadId={threadRootId}
        canPin={canPin}
        isNews={!!room.is_news}
        // Каналы-дневники («Дневник» / «Личный дневник») рендерят текст как markdown —
        // там ведут ежедневные записи с оформлением. Новостной канал (тоже channel) и
        // личные чаты/группы — простой текст.
        markdown={room.type === 'channel' && !room.is_news}
        onClearEdit={() => setEditingId(null)}
        onToggleThread={(rootId) => (threadRootId === rootId ? closeThread() : setThreadRootId(rootId))}
        onRepost={handleRepost}
        onOpenMenu={msgMenu.openMenu}
        onAtBottomChange={(bottom) => { if (bottom) tryMarkRead() }}
      />
      <TypingIndicator roomId={roomId} users={users} />
      {room.is_personal && room.created_by === user?.id && (
        <DailyJournalForm roomId={roomId} />
      )}
      {/* Верхнеуровневый ввод: в чужом личном канале нельзя писать вообще;
          в новостном — только админ. Комментировать можно через треды.
          В своём личном дневнике композер СКРЫТ, пока пользователь не выбрал режим
          в DailyJournalForm — раздел задания (pendingJournal) или свободную запись
          (journalFreeEntry): нельзя написать «просто так», не выбрав ничего.
          НО когда открыт тред — композер показываем всегда (в режиме ответа): ответить
          в тред можно везде, даже там, где верхний уровень запрещён (комментарии). */}
      {(threadRootId != null ||
        ((!room.is_personal || room.created_by === user?.id) &&
          (!room.is_news || user?.role === 'admin') &&
          (!isOwnPersonal || journalChosen))) && (
        <Composer
          roomId={roomId}
          isNews={room.is_news}
          revealOnMount={isOwnPersonal}
          threadRootId={threadRootId}
          threadRoot={threadRoot}
          onExitThread={closeThread}
          onFocusInput={() => {
            // Тап по полю → клавиатура открывается; докручиваем ленту к низу и сразу,
            // и после того как вьюпорт сожмётся (несколько кадров), чтобы последнее
            // сообщение осталось над клавиатурой.
            const toBottom = () => messageListRef.current?.scrollToBottom()
            toBottom()
            setTimeout(toBottom, 150)
            setTimeout(toBottom, 350)
          }}
        />
      )}
      {msgMenu.menu && (
        <MessageActionsMenu
          anchor={msgMenu.menu.anchor}
          items={msgMenu.buildItems(msgMenu.menu.msg)}
          onClose={msgMenu.closeMenu}
        />
      )}
      {showPins && (
        <PinsDrawer roomId={roomId} onClose={() => setShowPins(false)} onNavigate={navigateToMessage} />
      )}
      {showMembers && (
        <MembersDrawer
          roomId={roomId}
          isOwner={room.type === 'group' && room.created_by === user?.id}
          onClose={() => setShowMembers(false)}
          onOpenDm={onOpenRoom}
          onDeleted={() => {
            setShowMembers(false)
            onBack?.()
          }}
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
