import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { FaqItemOut } from '../lib/types'

export const faqKey = ['faq'] as const

/** Список FAQ (любой активный пользователь). */
export function useFaqItems() {
  return useQuery({
    queryKey: faqKey,
    queryFn: () => http.get<FaqItemOut[]>('/api/faq'),
  })
}

export interface FaqCreateBody {
  question: string
  answer: string
  sort_order?: number
}

export interface FaqUpdateBody {
  question?: string
  answer?: string
  sort_order?: number
}

export function useCreateFaq() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FaqCreateBody) =>
      http.post<FaqItemOut>('/api/faq', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: faqKey }),
  })
}

export function useUpdateFaq() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & FaqUpdateBody) =>
      http.patch<FaqItemOut>(`/api/faq/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: faqKey }),
  })
}

export function useDeleteFaq() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<null>(`/api/faq/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: faqKey }),
  })
}
