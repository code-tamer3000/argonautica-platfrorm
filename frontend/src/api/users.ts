import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { http } from '../lib/apiClient'
import type { PublicUserOut } from '../lib/types'

export const usersKey = ['users'] as const

export function useUsers() {
  return useQuery({
    queryKey: usersKey,
    queryFn: () => http.get<PublicUserOut[]>('/api/users'),
    staleTime: 60_000,
  })
}

export function useUsersMap(): Map<number, PublicUserOut> {
  const { data } = useUsers()
  return useMemo(() => {
    const m = new Map<number, PublicUserOut>()
    for (const u of data ?? []) m.set(u.id, u)
    return m
  }, [data])
}

/**
 * Ник (в нижнем регистре) → id пользователя — для клик-перехода по @упоминанию
 * в тексте сообщения на профиль в «Аргонавтах». Регистронезависимость зеркалит
 * серверное сравнение в _mentioned_usernames (backend/app/services/notifications.py).
 */
export function useUsersByUsername(): Map<string, number> {
  const { data } = useUsers()
  return useMemo(() => {
    const m = new Map<string, number>()
    for (const u of data ?? []) m.set(u.username.toLowerCase(), u.id)
    return m
  }, [data])
}

/**
 * Ростер кандидатов для «начать чат»/группу (ARG-110) — каскадно отфильтрован по
 * рангу тарифа на сервере, отсортирован по рангу (для группировки секциями на
 * клиенте). Не путать с `useUsers()` — та lookup-таблица не сужается (см. её doc).
 * `intakeId` имеет смысл только для admin (сессионный фильтр `adminCurrentIntakeId`
 * из AdminLayout) — участнику сервер его молча игнорирует.
 */
export function useContacts(intakeId?: number | null) {
  return useQuery({
    queryKey: [...usersKey, 'contacts', intakeId ?? null] as const,
    queryFn: () =>
      http.get<PublicUserOut[]>(
        intakeId != null ? `/api/users/contacts?intake_id=${intakeId}` : '/api/users/contacts',
      ),
    staleTime: 60_000,
  })
}
