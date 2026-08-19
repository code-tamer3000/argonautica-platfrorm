import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRooms } from '../../api/rooms'
import type { NotificationKind } from '../../lib/types'

// Единая навигация «открыть цель уведомления» — для колокольчика и для клика по тосту.
export function useOpenNotification() {
  const navigate = useNavigate()
  const { data: rooms } = useRooms()
  return useCallback(
    (n: { kind: NotificationKind; room_id: number | null }) => {
      if (n.kind === 'cabin_granted') {
        navigate('/cabin')
      } else if (n.kind === 'news') {
        navigate('/news')
      } else if (n.room_id != null) {
        const room = rooms?.find((r) => r.id === n.room_id)
        const segment = room?.type === 'channel' ? 'diaries' : 'chats'
        navigate(`/${segment}/${n.room_id}`)
      }
    },
    [navigate, rooms],
  )
}
