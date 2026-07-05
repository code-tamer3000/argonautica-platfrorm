import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { CabinData, CabinEntryOut, CabinKind } from '../lib/types'

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
