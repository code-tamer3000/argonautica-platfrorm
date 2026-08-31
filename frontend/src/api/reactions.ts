import { useMutation } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { MessageOut } from '../lib/types'

// Без оптимистичного апдейта и без invalidate — как usePin/useUnpin: состояние
// приходит через reaction.added/reaction.removed (useRealtime), задержка та же,
// что у message.new.
export function useToggleReaction(roomId: number) {
  return useMutation({
    mutationFn: (msg: MessageOut) =>
      msg.reacted_by_me
        ? http.del<null>(`/api/rooms/${roomId}/messages/${msg.id}/reaction`)
        : http.post<null>(`/api/rooms/${roomId}/messages/${msg.id}/reaction`),
  })
}
