import { useEffect, useState } from 'react'
import { useRooms } from '../../api/rooms'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useUiStore } from '../../stores/ui'
import { ChatPane } from './ChatPane'
import { RoomList } from './RoomList'
import styles from './chat.module.css'

interface Props {
  /** 'news' — при заходе автоматически открыть новостной канал (кнопка «Новости»). */
  autoOpen?: 'news'
}

export function ChatLayout({ autoOpen }: Props = {}) {
  const [roomId, setRoomId] = useState<number | null>(null)
  const [autoOpened, setAutoOpened] = useState(false)
  const { data: rooms } = useRooms()
  const setActiveRoom = useUiStore((s) => s.setActiveRoom)
  const pendingOpen = useUiStore((s) => s.pendingOpen)
  const setPendingOpen = useUiStore((s) => s.setPendingOpen)
  const isMobile = useIsMobile()

  // Открыть комнату по внешнему запросу (клик по уведомлению/колокольчику).
  useEffect(() => {
    if (!pendingOpen) return
    setRoomId(pendingOpen.roomId)
    setPendingOpen(null)
  }, [pendingOpen, setPendingOpen])

  // Один раз после загрузки комнат открываем новостной канал (для маршрута /news).
  useEffect(() => {
    if (autoOpen !== 'news' || autoOpened || !rooms) return
    const news = rooms.find((r) => r.is_news)
    if (news) {
      setRoomId(news.id)
      setAutoOpened(true)
    }
  }, [autoOpen, autoOpened, rooms])

  useEffect(() => {
    setActiveRoom(roomId)
    return () => setActiveRoom(null)
  }, [roomId, setActiveRoom])

  // На мобиле — master-detail: либо список, либо открытый чат.
  const showList = !isMobile || roomId == null
  const showPane = !isMobile || roomId != null

  return (
    <div className={`row grow ${styles.layout}`}>
      {showList && <RoomList selectedId={roomId} onSelect={setRoomId} />}
      {showPane && (
        <div className={`grow ${styles.pane}`}>
          {roomId ? (
            // key по roomId → при смене чата обёртка перемонтируется и открытый
            // чат мягко «выезжает» снизу вверх (см. .paneEnter), а не подменяется резко.
            <div key={roomId} className={styles.paneEnter}>
              <ChatPane
                roomId={roomId}
                onOpenRoom={setRoomId}
                onBack={isMobile ? () => setRoomId(null) : undefined}
              />
            </div>
          ) : (
            <div className={styles.empty}>Выберите чат, чтобы начать общение</div>
          )}
        </div>
      )}
    </div>
  )
}
