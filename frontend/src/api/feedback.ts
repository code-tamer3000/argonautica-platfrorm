import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { FeedbackKind, FeedbackListOut } from '../lib/types'

export const feedbackListKey = ['admin', 'feedback'] as const

export interface FeedbackCreateBody {
  kind: FeedbackKind
  body: string
}

/** Пользователь отправляет обращение (предложение/баг) из раздела «Поддержка». */
export function useCreateFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FeedbackCreateBody) =>
      http.post<{ status: string }>('/api/feedback', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackListKey }),
  })
}

/** Админская лента обращений + счётчик неразобранных. */
export function useFeedbackList() {
  return useQuery({
    queryKey: feedbackListKey,
    queryFn: () => http.get<FeedbackListOut>('/api/admin/feedback'),
  })
}

/** Отметить обращение разобранным или вернуть в работу. */
export function useResolveFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, resolved }: { id: number; resolved: boolean }) =>
      http.patch<null>(`/api/admin/feedback/${id}`, { resolved }),
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackListKey }),
  })
}
