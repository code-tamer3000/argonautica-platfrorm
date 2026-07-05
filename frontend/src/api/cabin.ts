import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type {
  AdminCabinEntryOut,
  AdminCabinUser,
  CabinData,
  CabinEntryOut,
  CabinKind,
} from '../lib/types'

export const cabinKey = (kind: CabinKind) => ['cabin', kind] as const

/** Список своих записей одного подраздела (сначала новые). */
export function useCabinEntries(kind: CabinKind) {
  return useQuery({
    queryKey: cabinKey(kind),
    queryFn: () => http.get<CabinEntryOut[]>(`/api/cabin/${kind}`),
  })
}

/** Создать новую «плашку» в подразделе. */
export function useCreateCabinEntry(kind: CabinKind) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CabinData) =>
      http.post<CabinEntryOut>(`/api/cabin/${kind}`, { data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cabinKey(kind) }),
  })
}

/** Заменить содержимое своей записи. */
export function useUpdateCabinEntry(kind: CabinKind) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CabinData }) =>
      http.put<CabinEntryOut>(`/api/cabin/${kind}/${id}`, { data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cabinKey(kind) }),
  })
}

/** Удалить свою запись. */
export function useDeleteCabinEntry(kind: CabinKind) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<null>(`/api/cabin/${kind}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: cabinKey(kind) }),
  })
}

// ─── Админский просмотр (только для роли admin) ───────────────────────────────

/** Участники, у которых есть записи в Каюте (для выбора в админке). */
export function useAdminCabinUsers() {
  return useQuery({
    queryKey: ['cabin', 'admin', 'users'] as const,
    queryFn: () => http.get<AdminCabinUser[]>('/api/cabin/admin/users'),
  })
}

/** Записи участника в подразделе (админский просмотр, только чтение). */
export function useAdminCabinEntries(kind: CabinKind, userId: number | null) {
  return useQuery({
    queryKey: ['cabin', 'admin', kind, userId] as const,
    enabled: userId != null,
    queryFn: () =>
      http.get<AdminCabinEntryOut[]>(`/api/cabin/admin/${kind}?user_id=${userId}`),
  })
}
