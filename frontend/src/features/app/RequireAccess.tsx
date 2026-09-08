import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ObserverBlocked } from './ObserverBlocked'

/**
 * Единая точка входа для правил доступа к разделам приложения. Раньше было три
 * механизма для одного понятия «доступ» (тернарник в роуте, тернарник с Navigate,
 * ранний return в компоненте) — теперь одно правило из routes.tsx решает и что
 * рендерить на маршруте, и виден ли пункт в наве (см. isRouteVisible).
 */
export type Access =
  | { kind: 'public' }
  | { kind: 'observerBlocked' }
  | { kind: 'requiresCabinGrant' }
  | { kind: 'adminOnly' }
  | { kind: 'rosterAccess' }

export interface AccessContext {
  isObserver: boolean
  canCabin: boolean
  isAdmin: boolean
  // Аргонавты (`app/api/argonauts.py` `_deny_cheap_tariff`): наблюдателю и
  // держателю самого дешёвого тарифа раздел закрыт целиком — две независимые
  // группы с урезанным доступом (см. is_cheap_tariff на бэке).
  canRoster: boolean
}

export function useAccessContext(): AccessContext {
  const { user } = useAuth()
  const isObserver = !!user?.is_observer
  return {
    isObserver,
    // Наблюдателю Каюта закрыта, даже если админ выдал грант.
    canCabin: !isObserver && (!!user?.can_access_cabin || user?.role === 'admin'),
    isAdmin: user?.role === 'admin',
    canRoster: !isObserver && !user?.is_cheap_tariff,
  }
}

export function isRouteVisible(access: Access, ctx: AccessContext): boolean {
  switch (access.kind) {
    case 'public':
      return true
    case 'observerBlocked':
      return !ctx.isObserver
    case 'requiresCabinGrant':
      return ctx.canCabin
    case 'adminOnly':
      return ctx.isAdmin
    case 'rosterAccess':
      return ctx.canRoster
  }
}

export function RequireAccess({ access }: { access: Access }) {
  const ctx = useAccessContext()
  if (isRouteVisible(access, ctx)) return <Outlet />
  // Дешёвому тарифу отдельной заглушки нет (в отличие от наблюдателя) — просто
  // уводим на главную, как остальные закрытые разделы.
  if (access.kind === 'observerBlocked' || access.kind === 'rosterAccess') {
    return ctx.isObserver ? <ObserverBlocked /> : <Navigate to="/" replace />
  }
  return <Navigate to="/" replace />
}
