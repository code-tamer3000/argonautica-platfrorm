import { useEffect, useState } from 'react'
import { useUiStore } from '../../stores/ui'
import { ChatPane } from './ChatPane'
import { RoomList } from './RoomList'
import styles from './chat.module.css'

export function ChatLayout() {
  const [roomId, setRoomId] = useState<number | null>(null)
  const setActiveRoom = useUiStore((s) => s.setActiveRoom)

  useEffect(() => {
    setActiveRoom(roomId)
    return () => setActiveRoom(null)
  }, [roomId, setActiveRoom])

  return (
    <div className={`row grow ${styles.layout}`}>
      <RoomList selectedId={roomId} onSelect={setRoomId} />
      <div className={`grow ${styles.pane}`}>
        {roomId ? (
          <ChatPane key={roomId} roomId={roomId} />
        ) : (
          <div className={styles.empty}>Выберите чат, чтобы начать общение</div>
        )}
      </div>
    </div>
  )
}
