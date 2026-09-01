import { useQuery } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { ArgonautDetailOut, ArgonautOut } from '../lib/types'

export const argonautsKey = ['argonauts'] as const
export const argonautKey = (userId: number) => [...argonautsKey, userId] as const

export function useArgonauts() {
  return useQuery({
    queryKey: argonautsKey,
    queryFn: () => http.get<ArgonautOut[]>('/api/argonauts'),
    staleTime: 60_000,
  })
}

export function useArgonaut(userId: number) {
  return useQuery({
    queryKey: argonautKey(userId),
    queryFn: () => http.get<ArgonautDetailOut>(`/api/argonauts/${userId}`),
    staleTime: 60_000,
  })
}
