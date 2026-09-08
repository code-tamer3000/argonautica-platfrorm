import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { AdminDynamicsOut, MyDynamicsOut } from '../lib/types'

export const myDynamicsKey = ['dynamics', 'me'] as const
export const adminDynamicsKey = ['dynamics', 'admin'] as const

export function useMyDynamics(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: myDynamicsKey,
    queryFn: () => http.get<MyDynamicsOut>('/api/dynamics/my-stats'),
    enabled: options?.enabled ?? true,
  })
}

export function usePardon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: string) => http.post<MyDynamicsOut>('/api/dynamics/pardon', { date }),
    onSuccess: (data) => {
      qc.setQueryData(myDynamicsKey, data)
    },
  })
}

/**
 * Обзор Динамики для админа. `intakeId` режет выдачу (и сводку) по набору на
 * сервере; `undefined` — все наборы сразу. `planIds` аналогично режет по
 * тарифу(ам) — `undefined` означает «все тарифы», а НЕ «ни одного»; пустой
 * массив запрещён вызывающей стороной (см. AdminDynamics.tsx). `enabled: false`
 * — пока неизвестно, какой набор/тарифы активны (справочники ещё грузятся):
 * без этого ушёл бы лишний запрос без нужного фильтра.
 */
export function useAdminDynamics(intakeId?: number, planIds?: number[], enabled = true) {
  const params = new URLSearchParams()
  if (intakeId !== undefined) params.append('intake_id', String(intakeId))
  for (const id of planIds ?? []) params.append('plan_id', String(id))
  const qs = params.toString()

  return useQuery({
    enabled,
    queryKey: [...adminDynamicsKey, intakeId ?? 'all', planIds ?? 'all'] as const,
    queryFn: () =>
      http.get<AdminDynamicsOut>(`/api/admin/dynamics${qs ? `?${qs}` : ''}`),
    refetchInterval: 60_000,
  })
}

export function useAdminCreditDay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { userId: number; date: string; credited: boolean }) =>
      http.post<AdminDynamicsOut>('/api/admin/dynamics/credit', {
        user_id: vars.userId,
        date: vars.date,
        credited: vars.credited,
      }),
    onSuccess: () => {
      // Ответ ручки зачёта — всегда полная выдача без фильтра, а на экране может
      // быть выбран набор: класть его в кэш отфильтрованного ключа нельзя.
      qc.invalidateQueries({ queryKey: adminDynamicsKey })
    },
  })
}
