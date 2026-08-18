import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { AdminDynamicsOut, MyDynamicsOut } from '../lib/types'

export const myDynamicsKey = ['dynamics', 'me'] as const
export const adminDynamicsKey = ['dynamics', 'admin'] as const

export function useMyDynamics() {
  return useQuery({
    queryKey: myDynamicsKey,
    queryFn: () => http.get<MyDynamicsOut>('/api/dynamics/my-stats'),
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
 * сервере; `undefined` — все наборы сразу. `enabled: false` — пока неизвестно,
 * какой набор активен (список наборов ещё грузится): без этого ушёл бы лишний
 * запрос за всеми наборами.
 */
export function useAdminDynamics(intakeId?: number, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...adminDynamicsKey, intakeId ?? 'all'] as const,
    queryFn: () =>
      http.get<AdminDynamicsOut>(
        intakeId === undefined
          ? '/api/admin/dynamics'
          : `/api/admin/dynamics?intake_id=${intakeId}`,
      ),
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
