import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NotificationKind } from '../../lib/types'
import { useUiStore } from '../../stores/ui'

// Единая навигация «открыть цель уведомления» — для колокольчика и для клика по тосту.
// Новость открывается через маршрут /news (там канал авто-открывается), остальные
// комнаты — через pendingOpen, который подхватывает ChatLayout на маршруте «/».
export function useOpenNotification() {
  const navigate = useNavigate()
  const setPendingOpen = useUiStore((s) => s.setPendingOpen)
  return useCallback(
    (n: { kind: NotificationKind; room_id: number | null }) => {
      if (n.kind === 'cabin_granted') {
        navigate('/cabin')
      } else if (n.kind === 'news') {
        navigate('/news')
      } else if (n.room_id != null) {
        setPendingOpen({ roomId: n.room_id })
        navigate('/')
      }
    },
    [navigate, setPendingOpen],
  )
}
