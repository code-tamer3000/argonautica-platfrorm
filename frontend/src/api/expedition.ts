import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { Element, LockOut } from '../lib/types'
import { dashboardKey } from './dashboard'

export const expeditionLocksKey = ['expedition', 'locks'] as const

export function useExpeditionLocks() {
  return useQuery({
    queryKey: expeditionLocksKey,
    queryFn: () => http.get<LockOut[]>('/api/expedition/locks'),
  })
}

// Ввод замка — идемпотентный upsert (не бросок): повторный вызов правит запись.
// 403, если эфир этапа ещё не прошёл. Инвалидирует и дашборд (тот же круг там).
export function useSetExpeditionLock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ element, keyNumber }: { element: Element; keyNumber: number }) =>
      http.put<LockOut>(`/api/expedition/locks/${element}`, { key_number: keyNumber }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: expeditionLocksKey })
      qc.invalidateQueries({ queryKey: dashboardKey })
    },
  })
}
