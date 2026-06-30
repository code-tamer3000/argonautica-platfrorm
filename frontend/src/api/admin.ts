import { useMutation, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { UserOut } from '../lib/types'
import { usersKey } from './users'

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
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  })
}
