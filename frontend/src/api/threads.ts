import { useQuery } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { ThreadOut } from '../lib/types'

export const threadKey = (roomId: number, rootId: number) => ['thread', roomId, rootId] as const

export function useThread(roomId: number, rootId: number | null) {
  return useQuery({
    queryKey: threadKey(roomId, rootId ?? 0),
    queryFn: () => http.get<ThreadOut>(`/api/rooms/${roomId}/messages/${rootId}/thread`),
    enabled: rootId != null,
  })
}
