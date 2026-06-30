import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { http } from '../lib/apiClient'
import type { PublicUserOut } from '../lib/types'

export const usersKey = ['users'] as const

export function useUsers() {
  return useQuery({
    queryKey: usersKey,
    queryFn: () => http.get<PublicUserOut[]>('/api/users'),
    staleTime: 60_000,
  })
}

export function useUsersMap(): Map<number, PublicUserOut> {
  const { data } = useUsers()
  return useMemo(() => {
    const m = new Map<number, PublicUserOut>()
    for (const u of data ?? []) m.set(u.id, u)
    return m
  }, [data])
}
