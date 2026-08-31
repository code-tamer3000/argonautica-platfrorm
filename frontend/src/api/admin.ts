import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { http } from '../lib/apiClient'
import type { AdminUserOut, IntakeOut, StageIn, UserOut } from '../lib/types'
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
  is_navigator?: boolean
  role?: 'participant' | 'admin'
  display_name?: string
  email?: string | null
  intake_id?: number
}

/**
 * Список участников. `intakeId` фильтрует по набору на сервере; `undefined` — все
 * наборы сразу (режим «показать все» в админке). `enabled=false` — не стрелять
 * запросом вовсе (нужно для мест вне гарантированно-админского экрана, см.
 * `useAdminUsersMap`, где вызывающая сторона решает по роли текущего юзера).
 */
export function useAdminUsers(intakeId?: number, enabled = true) {
  return useQuery({
    queryKey: [...adminUsersKey, intakeId ?? 'all'] as const,
    queryFn: () =>
      http.get<AdminUserOut[]>(
        intakeId === undefined
          ? '/api/admin/users'
          : `/api/admin/users?intake_id=${intakeId}`,
      ),
    enabled,
  })
}

/**
 * Все участники (без фильтра по набору) в виде `id → участник`. Нужен там, где надо
 * показать имя уже назначенного человека, даже если его набор сейчас отфильтрован.
 * `enabled=false` для экранов, где вызывающий не гарантированно admin (эндпоинт
 * `/api/admin/users` иначе 403 для обычного участника).
 */
export function useAdminUsersMap(enabled = true): Map<number, AdminUserOut> {
  const { data } = useAdminUsers(undefined, enabled)
  return useMemo(() => {
    const m = new Map<number, AdminUserOut>()
    for (const u of data ?? []) m.set(u.id, u)
    return m
  }, [data])
}

/**
 * Наборы, свежие сверху: первый в списке — активный (максимальная starts_on).
 * `enabled=false` — не стрелять запросом там, где вызывающий не гарантированно
 * admin (эндпоинт иначе 403 для обычного участника), тот же приём, что в
 * `useAdminUsersMap`.
 */
export function useAdminIntakes(enabled = true) {
  return useQuery({
    queryKey: adminIntakesKey,
    queryFn: () => http.get<IntakeOut[]>('/api/admin/intakes'),
    enabled,
  })
}

export function useCreateIntake() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { starts_on: string; ends_on: string }) =>
      http.post<IntakeOut>('/api/admin/intakes', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminIntakesKey })
    },
  })
}

/** Подвинуть дату закрытия набора (ARG-96). `starts_on` без API — см. ARG-89. */
export function useUpdateIntake() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ends_on }: { id: number; ends_on: string }) =>
      http.patch<IntakeOut>(`/api/admin/intakes/${id}`, { ends_on }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminIntakesKey })
    },
  })
}

// --- Круг Экспедиции: расписание этапов потока ------------------------------

export const intakeStagesKey = (intakeId: number) => ['admin', 'intakes', intakeId, 'stages'] as const

// Ответ бэкенда (schemas.expedition.StageOut) структурно совпадает с StageIn
// (kind/air_date/air_time/task_id) — отдельный тип на фронте не заводим.
/** Расписание этапов потока. Пустой список — не заведено (см. StagesUpdate). */
export function useIntakeStages(intakeId: number | null) {
  return useQuery({
    queryKey: intakeStagesKey(intakeId ?? -1),
    queryFn: () => http.get<StageIn[]>(`/api/admin/intakes/${intakeId}/stages`),
    enabled: intakeId != null,
  })
}

/** Заменяет расписание целиком — ровно шесть этапов, один раз каждой стихии. */
export function useSetIntakeStages() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ intakeId, stages }: { intakeId: number; stages: StageIn[] }) =>
      http.put<StageIn[]>(`/api/admin/intakes/${intakeId}/stages`, { stages }),
    onSuccess: (_data, { intakeId }) => {
      qc.invalidateQueries({ queryKey: intakeStagesKey(intakeId) })
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
