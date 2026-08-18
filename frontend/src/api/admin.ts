import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { AdminUserOut, IntakeOut, UserOut } from '../lib/types'
import { usersKey } from './users'

export const adminUsersKey = ['admin', 'users'] as const
export const adminIntakesKey = ['admin', 'intakes'] as const

export interface CreateUserBody {
  username: string
  display_name: string
  email?: string | null
  role?: 'participant' | 'admin'
  /** Набор обязателен: от его даты старта считается окно Динамики участника. */
  intake_id: number
}

export interface CreateUserResult {
  id: number
  username: string
  one_time_password: string
}

export interface PatchAdminUserBody {
  can_create_groups?: boolean
  can_access_cabin?: boolean
  is_observer?: boolean
  role?: 'participant' | 'admin'
  display_name?: string
  email?: string | null
  intake_id?: number
}

/**
 * Список участников. `intakeId` фильтрует по набору на сервере; `undefined` — все
 * наборы сразу (режим «показать все» в админке).
 */
export function useAdminUsers(intakeId?: number) {
  return useQuery({
    queryKey: [...adminUsersKey, intakeId ?? 'all'] as const,
    queryFn: () =>
      http.get<AdminUserOut[]>(
        intakeId === undefined
          ? '/api/admin/users'
          : `/api/admin/users?intake_id=${intakeId}`,
      ),
  })
}

/** Наборы, свежие сверху: первый в списке — активный (максимальная starts_on). */
export function useAdminIntakes() {
  return useQuery({
    queryKey: adminIntakesKey,
    queryFn: () => http.get<IntakeOut[]>('/api/admin/intakes'),
  })
}

export function useCreateIntake() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { starts_on: string }) =>
      http.post<IntakeOut>('/api/admin/intakes', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminIntakesKey })
    },
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateUserBody) =>
      http.post<CreateUserResult>('/api/admin/users', body),
    onSuccess: () => {
      // Новый участник обязан сразу появиться в своей группе, а счётчик набора — вырасти.
      qc.invalidateQueries({ queryKey: adminUsersKey })
      qc.invalidateQueries({ queryKey: adminIntakesKey })
      qc.invalidateQueries({ queryKey: usersKey })
    },
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
      qc.invalidateQueries({ queryKey: adminIntakesKey })
    },
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<void>(`/api/admin/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersKey })
      qc.invalidateQueries({ queryKey: adminIntakesKey })
      qc.invalidateQueries({ queryKey: usersKey })
    },
  })
}
