import { useQuery } from '@tanstack/react-query'
import { http } from '../lib/apiClient'

export interface UserNotifPrefs {
  user_id: number
  display_name: string
  push_enabled: boolean
  dm: boolean
  reply: boolean
  news: boolean
  mention: boolean
  admin: boolean
  devices: number
}

interface NotifPrefsOverview {
  items: UserNotifPrefs[]
}

// Обзор «у кого включены уведомления» (только для админа).
export function useNotifPrefsOverview() {
  return useQuery({
    queryKey: ['admin', 'notif-prefs'],
    queryFn: () => http.get<NotifPrefsOverview>('/api/admin/notifications/prefs'),
  })
}
