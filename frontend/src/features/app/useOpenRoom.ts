import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRooms } from '../../api/rooms'

/** Открыть комнату из любого раздела приложения (чат живёт на /chats и /diaries). */
export function useOpenRoom() {
  const navigate = useNavigate()
  const { data: rooms } = useRooms()
  return useCallback(
    (roomId: number) => {
      const room = rooms?.find((r) => r.id === roomId)
      const segment = room?.type === 'channel' ? 'diaries' : 'chats'
      navigate(`/${segment}/${roomId}`)
    },
    [navigate, rooms],
  )
}
