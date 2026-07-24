import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { MemberOut, RoomOut, RoomType } from '../lib/types'

export const roomsKey = ['rooms'] as const

export function useRooms() {
  return useQuery({ queryKey: roomsKey, queryFn: () => http.get<RoomOut[]>('/api/rooms') })
}

// Одна комната по id. Нужна, когда её нет в списке `useRooms` — админ входит в
// комнату подгруппы потока через кнопку на карточке узла, но членства (а значит и
// строки в списке) у него нет. `enabled` — включаем фолбэк только при промахе списка.
export function useRoom(roomId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['room', roomId],
    queryFn: () => http.get<RoomOut>(`/api/rooms/${roomId}`),
    enabled,
  })
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

export function useDeleteRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (roomId: number) => http.del<null>(`/api/rooms/${roomId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: roomsKey }),
  })
}

export function usePersonalChannel() {
  return useQuery({
    queryKey: ['personal-channel'],
    queryFn: () => http.get<RoomOut>('/api/rooms/personal'),
  })
}
