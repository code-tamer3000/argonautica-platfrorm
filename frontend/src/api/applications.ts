import { useQuery } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { ApplicationFunnelOut } from '../lib/types'

export const adminApplicationsKey = ['admin', 'applications'] as const

/** Read-only снимок воронки приёма (ARG-107) — заявку по-прежнему двигает только
 * Telegram-бот, здесь только просмотр. Автообновление раз в минуту (как Динамика). */
export function useAdminApplications(intakeId: number | null, enabled = true) {
  return useQuery({
    queryKey: [...adminApplicationsKey, intakeId],
    // intakeId === null — «все потоки» (параметр не передаём). ARG-189.
    queryFn: () =>
      http.get<ApplicationFunnelOut>(
        intakeId == null ? '/api/admin/applications' : `/api/admin/applications?intake_id=${intakeId}`,
      ),
    enabled,
    refetchInterval: 60_000,
  })
}
