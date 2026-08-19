import { useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useUiStore } from '../../stores/ui'
import { ChatPane } from './ChatPane'
import { RoomList, type Tab } from './RoomList'
import styles from './chat.module.css'

interface Props {
  tab: Tab
}

const basePathFor = (tab: Tab) => (tab === 'chats' ? '/chats' : '/diaries')

export function ChatLayout({ tab }: Props) {
  const { roomId: roomIdParam } = useParams<{ roomId?: string }>()
  const roomId = roomIdParam ? Number(roomIdParam) : null
  const navigate = useNavigate()
  const setActiveRoom = useUiStore((s) => s.setActiveRoom)
  const isMobile = useIsMobile()

  const basePath = basePathFor(tab)

  const handleSelect = useCallback(
    (id: number) => navigate(`${basePath}/${id}`),
    [navigate, basePath],
  )

  const handleTabChange = useCallback(
    (nextTab: Tab) => navigate(basePathFor(nextTab)),
    [navigate],
  )

  useEffect(() => {
    setActiveRoom(roomId)
    return () => setActiveRoom(null)
  }, [roomId, setActiveRoom])

  // На мобиле — master-detail: либо список, либо открытый чат.
  const showList = !isMobile || roomId == null
  const showPane = !isMobile || roomId != null

  return (
    <div className={`row grow ${styles.layout}`}>
      {showList && (
        <RoomList tab={tab} onTabChange={handleTabChange} selectedId={roomId} onSelect={handleSelect} />
      )}
      {showPane && (
        <div className={`grow ${styles.pane}`}>
          {roomId ? (
            // key по roomId → при смене чата обёртка перемонтируется и открытый
            // чат мягко «выезжает» снизу вверх (см. .paneEnter), а не подменяется резко.
            <div key={roomId} className={styles.paneEnter}>
              <ChatPane
                roomId={roomId}
                onOpenRoom={handleSelect}
                onBack={isMobile ? () => navigate(basePath) : undefined}
              />
            </div>
          ) : (
            <EmptyState size="block">Выберите чат, чтобы начать общение</EmptyState>
          )}
        </div>
      )}
    </div>
  )
}
