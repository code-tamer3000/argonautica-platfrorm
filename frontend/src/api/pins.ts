import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { PinnedOut } from '../lib/types'

export const pinsKey = (roomId: number) => ['pins', roomId] as const

export function usePins(roomId: number, enabled: boolean) {
  return useQuery({
    queryKey: pinsKey(roomId),
    queryFn: () => http.get<PinnedOut[]>(`/api/rooms/${roomId}/pins`),
    enabled,
  })
}

export function usePin(roomId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (messageId: number) =>
      http.post<PinnedOut>(`/api/rooms/${roomId}/messages/${messageId}/pin`),
    onSuccess: () => qc.invalidateQueries({ queryKey: pinsKey(roomId) }),
  })
}

export function useUnpin(roomId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (messageId: number) =>
      http.del<null>(`/api/rooms/${roomId}/messages/${messageId}/pin`),
    onSuccess: () => qc.invalidateQueries({ queryKey: pinsKey(roomId) }),
  })
}
