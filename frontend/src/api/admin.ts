import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { AdminUserOut, ServerMetricsOut, UserOut } from '../lib/types'
import { usersKey } from './users'

/** Реалтайм-метрики сервера: опрос раз в 2 с (скорости считаются как дельта на бэке). */
export function useServerMetrics() {
  return useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: () => http.get<ServerMetricsOut>('/api/admin/metrics'),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    gcTime: 0,
  })
}

export const adminUsersKey = ['admin', 'users'] as const

export interface CreateUserBody {
  username: string
  display_name: string
  email?: string | null
  role?: 'participant' | 'admin'
}

export interface CreateUserResult {
  id: number
  username: string
  one_time_password: string
}

export interface PatchAdminUserBody {
  can_create_groups?: boolean
  role?: 'participant' | 'admin'
  display_name?: string
  email?: string | null
}

export function useAdminUsers() {
  return useQuery({
    queryKey: adminUsersKey,
    queryFn: () => http.get<AdminUserOut[]>('/api/admin/users'),
  })
}

export function useCreateUser() {
  return useMutation({
    mutationFn: (body: CreateUserBody) =>
      http.post<CreateUserResult>('/api/admin/users', body),
  })
}

export function usePatchAdminUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & PatchAdminUserBody) =>
      http.patch<UserOut>(`/api/admin/users/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKey })
      qc.invalidateQueries({ queryKey: adminUsersKey })
    },
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<void>(`/api/admin/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersKey })
      qc.invalidateQueries({ queryKey: usersKey })
    },
  })
}
