import { useQuery } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { ApplicationFunnelOut } from '../lib/types'

export const adminApplicationsKey = ['admin', 'applications'] as const

/** Read-only снимок воронки приёма (ARG-107) — заявку по-прежнему двигает только
 * Telegram-бот, здесь только просмотр. Автообновление раз в минуту (как Динамика). */
export function useAdminApplications() {
  return useQuery({
    queryKey: adminApplicationsKey,
    queryFn: () => http.get<ApplicationFunnelOut>('/api/admin/applications'),
    refetchInterval: 60_000,
  })
}
