import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { MemberOut, RoomOut, RoomType } from '../lib/types'

export const roomsKey = ['rooms'] as const

export function useRooms() {
  return useQuery({ queryKey: roomsKey, queryFn: () => http.get<RoomOut[]>('/api/rooms') })
}

export interface CreateRoomBody {
  type: RoomType
  name?: string
  peer_id?: number
}

export function useCreateRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateRoomBody) => http.post<RoomOut>('/api/rooms', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: roomsKey }),
  })
}

export function useRoomMembers(roomId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['members', roomId],
    queryFn: () => http.get<MemberOut[]>(`/api/rooms/${roomId}/members`),
    enabled,
  })
}

export function useAddMember(roomId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) =>
      http.post<MemberOut>(`/api/rooms/${roomId}/members`, { user_id: userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', roomId] }),
  })
}

// Не-хук: добавить участника. Нужен при создании группы (роста roomId на лету хук не умеет).
export const addRoomMember = (roomId: number, userId: number): Promise<MemberOut> =>
  http.post<MemberOut>(`/api/rooms/${roomId}/members`, { user_id: userId })

export function useRemoveMember(roomId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) => http.del<null>(`/api/rooms/${roomId}/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', roomId] })
      qc.invalidateQueries({ queryKey: roomsKey })
    },
  })
}
