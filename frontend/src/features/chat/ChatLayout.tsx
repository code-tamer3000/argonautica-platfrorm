import { useEffect, useState } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useUiStore } from '../../stores/ui'
import { ChatPane } from './ChatPane'
import { RoomList } from './RoomList'
import styles from './chat.module.css'

export function ChatLayout() {
  const [roomId, setRoomId] = useState<number | null>(null)
  const setActiveRoom = useUiStore((s) => s.setActiveRoom)
  const isMobile = useIsMobile()

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
            <ChatPane
              key={roomId}
              roomId={roomId}
              onOpenRoom={setRoomId}
              onBack={isMobile ? () => setRoomId(null) : undefined}
            />
          ) : (
            <div className={styles.empty}>Выберите чат, чтобы начать общение</div>
          )}
        </div>
      )}
    </div>
  )
}
