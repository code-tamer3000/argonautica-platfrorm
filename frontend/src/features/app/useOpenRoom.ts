import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '../../stores/ui'

/**
 * Открыть комнату из любого раздела приложения.
 *
 * Маршрута вида `/chat/:roomId` НЕТ: чат живёт на «/», а нужную комнату выбирает
 * ChatLayout по `pendingOpen` из ui-store. Поэтому ссылка `<Link to="/chat/12">`
 * попадает в несуществующий маршрут и даёт пустой экран — ходить сюда.
 */
export function useOpenRoom() {
  const navigate = useNavigate()
  const setPendingOpen = useUiStore((s) => s.setPendingOpen)
  return useCallback(
    (roomId: number) => {
      setPendingOpen({ roomId })
      navigate('/')
    },
    [navigate, setPendingOpen],
  )
}
