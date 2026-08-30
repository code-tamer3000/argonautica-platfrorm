import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { PlanOut, PlanPublicOut } from '../lib/types'

export const adminPlansKey = ['admin', 'plans'] as const

/** Все тарифы (включая неактивные) — только админ. */
export function useAdminPlans() {
  return useQuery({
    queryKey: adminPlansKey,
    queryFn: () => http.get<PlanOut[]>('/api/admin/plans'),
  })
}

export interface PlanCreateBody {
  name: string
  price: number
  description?: string
  is_active?: boolean
}

export interface PlanUpdateBody {
  name?: string
  price?: number
  description?: string
  is_active?: boolean
}

export function useCreatePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PlanCreateBody) =>
      http.post<PlanOut>('/api/admin/plans', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminPlansKey }),
  })
}

export function useUpdatePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & PlanUpdateBody) =>
      http.patch<PlanOut>(`/api/admin/plans/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminPlansKey }),
  })
}

export function useDeletePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<null>(`/api/admin/plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminPlansKey }),
  })
}

export const plansKey = ['plans'] as const

/** Активные тарифы, отсортированы по цене (любой активный пользователь, id+name
 * без цены/описания) — группировка «Все дневники» по тарифу владельца. */
export function usePlans() {
  return useQuery({
    queryKey: plansKey,
    queryFn: () => http.get<PlanPublicOut[]>('/api/plans'),
  })
}
