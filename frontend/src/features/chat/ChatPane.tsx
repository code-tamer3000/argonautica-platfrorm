import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMyDynamics } from '../../api/dynamics'
import { useMarkRead, useMessages } from '../../api/messages'
import { useRoom, useRooms, useSetDiaryAvatar } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { IconBack, IconEdit, IconPin, IconTrash, IconUsers } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { mediaUpload } from '../../lib/mediaUpload'
import { noteRoomRendered, sampleRoomResources } from '../../lib/metrics'
import type { MessageOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import { Composer } from './Composer'
import { DailyJournalForm } from './DailyJournalForm'
import { ForwardPicker } from './ForwardPicker'
import { GraduatedNotice } from './GraduatedNotice'
import { MembersDrawer } from './MembersDrawer'
import { MessageActionsMenu } from './MessageActionsMenu'
import { MessageList, type MessageListHandle } from './MessageList'
import { useMessageMenu } from './useMessageMenu'
import { PinsBar } from './PinsBar'
import { StreamRoomWidget } from '../tasks/stream/StreamRoomWidget'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: rooms } = useRooms()
  const listedRoom = rooms?.find((r) => r.id === roomId)
  // Комнаты нет в списке (админ вошёл в комнату подгруппы потока — членства нет) —
  // дотягиваем метаданные точечным запросом, иначе ниже завис бы вечный спиннер.
  const { data: fetchedRoom } = useRoom(roomId, !!rooms && !listedRoom)
  const room = listedRoom ?? fetchedRoom
  const users = useUsersMap()
  const dmPeers = useUiStore((s) => s.dmPeers)
  const setDmPeer = useUiStore((s) => s.setDmPeer)
  const setPendingForward = useUiStore((s) => s.setPendingForward)
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
  const [showProfile, setShowProfile] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarFileRef = useRef<HTMLInputElement>(null)
  const setDiaryAvatar = useSetDiaryAvatar(roomId)
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null)
  // Сообщение, для которого открыт пикер комнаты-назначения пересылки (см. ForwardPicker).
  const [forwardingMsg, setForwardingMsg] = useState<MessageOut | null>(null)
  const messageListRef = useRef<MessageListHandle>(null)
  // Корень треда, который только что свернули: после размонтирования InlineThread
  // (высота ленты уменьшится) плавно доводим экран обратно к нему, а не роняем в низ.
  const collapsedThreadRootRef = useRef<number | null>(null)

  // Право закрепления зеркалит backend `assert_can_pin` (SPEC §4.7): admin — всегда;
  // group — только владелец; dm — оба участника; channel — никому, кроме admin.
  const canPin = user?.role === 'admin' || room?.type === 'dm' ||
    (room?.type === 'group' && room.created_by === user?.id)

  // Пересылка: открываем пикер комнаты. Сам форвард уходит из композера выбранной
  // комнаты (handleForwardPick ниже) — там же можно дописать подпись перед отправкой.
  // useCallback: стабильная ссылка нужна мемоизированному MessageItem (иначе
  // memo пробивается на каждом ре-рендере ленты).
  const handleForward = useCallback((msg: MessageOut) => {
    setForwardingMsg(msg)
  }, [])

  const handleForwardPick = useCallback((targetRoomId: number) => {
    const msg = forwardingMsg
    setForwardingMsg(null)
    if (!msg) return
    setPendingForward({ sourceRoomId: roomId, targetRoomId, message: msg })
    if (targetRoomId !== roomId) onOpenRoom?.(targetRoomId)
  }, [forwardingMsg, roomId, setPendingForward, onOpenRoom])

  // Контекстное меню сообщения (общий хук для ленты и треда).
  const msgMenu = useMessageMenu({
    roomId,
    canPin: !!canPin,
    onReply: (msg) => setThreadRootId(msg.id),
    onEdit: (msg) => setEditingId(msg.id),
    onForward: handleForward,
  })

  // RUM: закрыть трейс «открытие комнаты», когда лента реально отрисована (ждём
  // кадр — до него список ещё не на экране), и посчитать, сколько байт медиа
  // скачал этот заход в комнату (первый против повторного — метрика кэша медиа).
  // Завязываемся на dataUpdatedAt, а не на «есть сообщения»: при заходе в комнату
  // лента сперва рисуется из восстановленного кэша (queryPersist), и трейс закрылся
  // бы ДО того, как пришла свежая история. Лишние вызовы безвредны — трейс без
  // запроса истории no-op.
  const historyReady = !query.isFetching && messages.length > 0 ? query.dataUpdatedAt : 0
  useEffect(() => {
    if (!historyReady) return
    const frame = requestAnimationFrame(() => noteRoomRendered(roomId))
    return () => cancelAnimationFrame(frame)
  }, [historyReady, roomId])

  useEffect(() => sampleRoomResources(roomId), [roomId])

  // Сбросить панели при смене комнаты.
  useEffect(() => {
    setEditingId(null)
    setThreadRootId(null)
    collapsedThreadRootRef.current = null // не доводить к корню из прошлой комнаты
    setShowPins(false)
    setShowMembers(false)
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

  // Переход из плитки календаря в профиле (?anchor=<messageId>): сообщение почти
  // наверняка ещё не в загруженной странице ленты (лента грузит от новых к старым
  // порциями по 40) — догружаем историю, пока не найдём его или не кончится лента.
  // Ограничение попыток — на случай битой ссылки, чтобы не подгружать всю историю.
  const anchorAttempts = useRef(0)
  useEffect(() => { anchorAttempts.current = 0 }, [roomId])
  useEffect(() => {
    const raw = searchParams.get('anchor')
    if (!raw) return
    const anchorId = Number(raw)
    const clearAnchor = () =>
      setSearchParams((p) => { p.delete('anchor'); return p }, { replace: true })
    if (!Number.isFinite(anchorId)) { clearAnchor(); return }

    const found = messageListRef.current?.scrollToMessage(anchorId)
    if (found) {
      setHighlightedMsgId(anchorId)
      setTimeout(() => setHighlightedMsgId(null), 2000)
      clearAnchor()
      return
    }
    if (query.hasNextPage && anchorAttempts.current < 20) {
      anchorAttempts.current += 1
      void query.fetchNextPage()
    } else {
      toast('Запись не найдена рядом — открой дневник вручную', 'error')
      clearAnchor()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, messages, query.hasNextPage])

  // Свернуть тред, оставшись на месте разговора. Раскрытый тред обычно упирается в
  // низ ленты, поэтому лента «прилипла» к нижней кромке; при схлопывании ResizeObserver
  // в MessageList утащил бы скролл в самый конец. Поэтому СНАЧАЛА снимаем прилипание
  // (releaseBottom — синхронно, до изменения высоты), запоминаем корень и после
  // размонтирования InlineThread плавно доводим экран к корневому сообщению.
  const closeThread = useCallback(() => {
    messageListRef.current?.releaseBottom()
    collapsedThreadRootRef.current = threadRootId
    setThreadRootId(null)
  }, [threadRootId])

  // После сворачивания треда лента «схлопывается» — доводим её плавно к корню,
  // от которого шёл тред, чтобы на мобильном не терять место в разговоре.
  useEffect(() => {
    if (threadRootId != null) return
    const rootId = collapsedThreadRootRef.current
    if (rootId == null) return
    collapsedThreadRootRef.current = null
    // Ждём кадр: размонтирование InlineThread успевает применить новую высоту ленты.
    requestAnimationFrame(() => messageListRef.current?.scrollToMessage(rootId))
  }, [threadRootId])

  // Стабильные колбэки для мемоизированного MessageList/MessageItem. Без них каждый
  // ре-рендер ChatPane (typing/presence/новое сообщение) пробивал бы memo и
  // перерисовывал всю ленту с медиа.
  const loadMore = useCallback(() => void query.fetchNextPage(), [query])
  const clearEdit = useCallback(() => setEditingId(null), [])
  const toggleThread = useCallback(
    (rootId: number) => {
      if (threadRootId === rootId) closeThread()
      else setThreadRootId(rootId)
    },
    [threadRootId, closeThread],
  )
  const onAtBottomChange = useCallback(
    (bottom: boolean) => { if (bottom) tryMarkRead() },
    [tryMarkRead],
  )

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
  // Выпускник: вся Рубка — только чтение (бэкенд закрывает те же пути 403).
  const isGraduated = !!user?.graduated_at
  // Окно набора закрыто (ARG-96): дневник — архив только для чтения, форму
  // отправки прячем (бэкенд 403-ит тот же путь). Запрос только для своего дневника.
  const { data: myDyn } = useMyDynamics({ enabled: isOwnPersonal })
  const isWindowClosed = isOwnPersonal && !!myDyn?.window_closed
  const journalChosen =
    pendingJournal?.roomId === roomId || journalFreeEntry === roomId

  function openHeaderInfo() {
    if (room?.type === 'dm') {
      if (peer) setShowProfile(true)
    } else if (room?.type === 'group') {
      setShowMembers(true)
    }
    // Личный дневник: раньше клик по шапке раскрывал календарь месяца — убран
    // (ARG-126), им никто не пользовался, а полный период теперь в профиле.
  }

  // Обложка своего дневника: файл жмётся тем же клиентским пайплайном, что и
  // остальные картинки (mediaUpload → lib/imageCompress.ts), затем ставится
  // через PATCH /api/rooms/{id}/avatar (владелец — только свой дневник).
  async function handleDiaryAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setAvatarUploading(true)
    try {
      const { asset } = await mediaUpload(file)
      setDiaryAvatar.mutate(asset.id, {
        onSuccess: () => toast('Обложка обновлена'),
        onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки', 'error')
    } finally {
      setAvatarUploading(false)
    }
  }

  function handleRemoveDiaryAvatar() {
    setAvatarMenuOpen(false)
    setDiaryAvatar.mutate(null, {
      onSuccess: () => toast('Обложка удалена'),
      onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <>
      <header className={styles.header}>
        {onBack && (
          <button className={styles.backBtn} onClick={onBack} title="Назад" aria-label="Назад">
            <IconBack size={22} />
          </button>
        )}
        {isOwnPersonal ? (
          <div className={styles.headerInfoRow}>
            <div className={styles.headerAvatarWrap}>
              {avatarUploading ? (
                <div className={styles.headerAvatarUploading}><Spinner size={16} /></div>
              ) : (
                <Avatar name={title} url={roomAvatarUrl(room, dmPeers, users)} square size={40} />
              )}
              <button
                type="button"
                className={styles.headerAvatarEditBadge}
                onClick={() => setAvatarMenuOpen((v) => !v)}
                disabled={avatarUploading}
                title="Обложка дневника"
                aria-label="Обложка дневника"
                aria-haspopup="menu"
                aria-expanded={avatarMenuOpen}
              >
                <IconEdit size={11} />
              </button>
              {avatarMenuOpen && (
                <>
                  <div className={styles.attachBackdrop} onClick={() => setAvatarMenuOpen(false)} />
                  <div className={styles.headerAvatarMenu} role="menu">
                    <button
                      className={styles.attachMenuItem}
                      onClick={() => { setAvatarMenuOpen(false); avatarFileRef.current?.click() }}
                    >
                      <IconEdit size={16} /> Сменить фото
                    </button>
                    {room.avatar_url && (
                      <button className={styles.attachMenuItem} onClick={handleRemoveDiaryAvatar}>
                        <IconTrash size={16} /> Удалить фото
                      </button>
                    )}
                  </div>
                </>
              )}
              <input
                ref={avatarFileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleDiaryAvatarChange}
              />
            </div>
            <div className={styles.headerInfoText}>
              <div className={styles.headerTitle}>
                {room.type === 'channel' ? '# ' : ''}
                {title}
              </div>
              <div className={styles.headerSub}>{subLabel(room.type, room.is_personal, room.is_news)}</div>
            </div>
          </div>
        ) : (
          <button
            className={styles.headerInfo}
            onClick={openHeaderInfo}
            title={
              room.type === 'dm' ? 'Открыть профиль' :
              room.type === 'group' ? 'Участники' :
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
        )}
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
      {/* Комната подгруппы потока — голосование за общую фразу над лентой. */}
      {room.stream_node_id != null && room.stream_task_id != null && (
        <StreamRoomWidget taskId={room.stream_task_id} nodeId={room.stream_node_id} />
      )}
      <MessageList
        key={roomId}
        ref={messageListRef}
        roomId={roomId}
        messages={messages}
        hasMore={!!query.hasNextPage}
        loadMore={loadMore}
        loading={query.isFetchingNextPage}
        users={users}
        editingId={editingId}
        selectedMsgId={msgMenu.menu?.msg.id ?? null}
        highlightedMsgId={highlightedMsgId}
        expandedThreadId={threadRootId}
        canPin={canPin}
        // Каналы-дневники («Дневник» / «Личный дневник») рендерят текст как markdown —
        // там ведут ежедневные записи с оформлением. Новостной канал (тоже channel) и
        // личные чаты/группы — простой текст.
        markdown={room.type === 'channel' && !room.is_news}
        onClearEdit={clearEdit}
        onToggleThread={toggleThread}
        onForward={handleForward}
        onOpenMenu={msgMenu.openMenu}
        onAtBottomChange={onAtBottomChange}
      />
      <TypingIndicator roomId={roomId} users={users} />
      {isOwnPersonal && !isGraduated && !isWindowClosed && (
        <DailyJournalForm roomId={roomId} />
      )}
      {/* Экспедиция пройдена: вместо любого ввода — плашка. История комнаты
          (личные чаты, дневник, каналы) остаётся доступной на чтение. */}
      {isGraduated && <GraduatedNotice />}
      {/* Окно набора закрыто (ARG-96): дневник — архив, статистика заморожена
          (см. ProfileScreen), новых записей быть не может. */}
      {!isGraduated && isWindowClosed && (
        <GraduatedNotice text="Окно набора закрыто — дневник в архиве" />
      )}
      {/* Верхнеуровневый ввод: в чужом личном канале нельзя писать вообще;
          в новостном — только админ. Комментировать можно через треды.
          В своём личном дневнике композер СКРЫТ, пока пользователь не выбрал режим
          в DailyJournalForm — раздел задания (pendingJournal) или свободную запись
          (journalFreeEntry): нельзя написать «просто так», не выбрав ничего.
          НО когда открыт тред — композер показываем всегда (в режиме ответа): ответить
          в тред можно везде, даже там, где верхний уровень запрещён (комментарии). */}
      {!isGraduated && !isWindowClosed && !room.dm_write_locked && (threadRootId != null ||
        ((!room.is_personal || room.created_by === user?.id) &&
          (!room.is_news || user?.role === 'admin') &&
          (!isOwnPersonal || journalChosen))) && (
        <Composer
          roomId={roomId}
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
      {forwardingMsg && (
        <ForwardPicker
          onClose={() => setForwardingMsg(null)}
          onPick={handleForwardPick}
        />
      )}
    </>
  )
}
