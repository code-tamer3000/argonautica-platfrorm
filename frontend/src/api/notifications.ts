import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { NotificationListOut } from '../lib/types'

export const notificationsKey = ['notifications'] as const

export function useNotifications() {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: () => http.get<NotificationListOut>('/api/notifications'),
  })
}

// Отметить прочитанными: upToId=undefined → все; иначе все с id <= upToId.
export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (upToId?: number) =>
      http.post<NotificationListOut>('/api/notifications/read', {
        up_to_id: upToId ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKey }),
  })
}
