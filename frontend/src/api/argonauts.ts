import { useQuery } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import { useAuth } from '../features/auth/AuthContext'
import { useUiStore } from '../stores/ui'
import type { ArgonautDetailOut, ArgonautsListOut } from '../lib/types'

export const argonautsKey = ['argonauts'] as const
export const argonautKey = (userId: number, intakeId: number | null = null) =>
  [...argonautsKey, userId, intakeId] as const

/** «Текущая экспедиция» админа (ARG-168): сервер учитывает intake_id только для
 * админа, для остальных параметр игнорируется — не шлём его вовсе. */
function useScopeIntakeId(): number | null {
  const { user } = useAuth()
  const current = useUiStore((s) => s.adminCurrentIntakeId)
  return user?.role === 'admin' ? current : null
}

const withIntake = (path: string, intakeId: number | null) =>
  intakeId != null ? `${path}?intake_id=${intakeId}` : path

export function useArgonauts() {
  const intakeId = useScopeIntakeId()
  return useQuery({
    queryKey: [...argonautsKey, 'list', intakeId] as const,
    queryFn: () => http.get<ArgonautsListOut>(withIntake('/api/argonauts', intakeId)),
    staleTime: 60_000,
  })
}

export function useArgonaut(userId: number) {
  const intakeId = useScopeIntakeId()
  return useQuery({
    queryKey: argonautKey(userId, intakeId),
    queryFn: () => http.get<ArgonautDetailOut>(withIntake(`/api/argonauts/${userId}`, intakeId)),
    staleTime: 60_000,
  })
}
