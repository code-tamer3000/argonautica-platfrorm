import { useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePersonalChannel } from '../../api/rooms'
import { EmptyState } from '../../components/EmptyState'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import { ChatPane } from './ChatPane'
import { RoomList, type Tab } from './RoomList'
import styles from './chat.module.css'

interface Props {
  tab: Tab
  // Набор ещё не начался (ARG-106): открытая новостная комната — единственное
  // исключение из гейта Рубки (см. routes.tsx withCohortGate/useIsNewsRoom). Список
  // комнат и переключатель Чаты/Дневники всё равно ведут в закрытую Рубку — прячем
  // их, оставляя только саму новость, а не намекаем на доступ, которого нет.
  hideRoomList?: boolean
}

const basePathFor = (tab: Tab) => (tab === 'chats' ? '/chats' : '/diaries')

export function ChatLayout({ tab, hideRoomList }: Props) {
  const { roomId: roomIdParam } = useParams<{ roomId?: string }>()
  const roomId = roomIdParam ? Number(roomIdParam) : null
  const navigate = useNavigate()
  const setActiveRoom = useUiStore((s) => s.setActiveRoom)
  const isMobile = useIsMobile()
  const { user: me } = useAuth()

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

  // Дешёвый тариф (ARG-114): «Все дневники» ему и так не приходят с сервера
  // (list_rooms), но список у него всё равно пуст без выбора — ведём сразу в
  // свой личный дневник, не оставляя на пустом экране-заглушке.
  const isCheapTariffDiaries = tab === 'channels' && me?.is_cheap_tariff === true
  const { data: personalChannel } = usePersonalChannel(isCheapTariffDiaries && roomId == null)
  useEffect(() => {
    if (isCheapTariffDiaries && roomId == null && personalChannel) {
      navigate(`${basePath}/${personalChannel.id}`, { replace: true })
    }
  }, [isCheapTariffDiaries, roomId, personalChannel, basePath, navigate])

  // На мобиле — master-detail: либо список, либо открытый чат.
  const showList = !hideRoomList && (!isMobile || roomId == null)
  const showPane = hideRoomList || !isMobile || roomId != null

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
                onBack={isMobile && !hideRoomList ? () => navigate(basePath) : undefined}
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
