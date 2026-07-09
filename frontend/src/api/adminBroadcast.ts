import { useMutation } from '@tanstack/react-query'
import { http } from '../lib/apiClient'

export interface BroadcastBody {
  title: string
  body: string
}

// Разослать уведомление всем пользователям (in-app + native push тем, у кого включено).
export function useAdminBroadcast() {
  return useMutation({
    mutationFn: (body: BroadcastBody) =>
      http.post<{ recipients: number }>('/api/admin/notifications/broadcast', body),
  })
}
