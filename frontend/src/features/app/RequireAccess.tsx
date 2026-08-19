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
  // redirectTo — для «/»: наблюдателя тихо уводим на домашние материалы, а не
  // показываем ObserverBlocked (это не тупик по прямой ссылке, а дефолтный вход).
  | { kind: 'observerBlocked'; redirectTo?: string }
  | { kind: 'requiresCabinGrant' }
  | { kind: 'adminOnly' }

export interface AccessContext {
  isObserver: boolean
  canCabin: boolean
  isAdmin: boolean
}

export function useAccessContext(): AccessContext {
  const { user } = useAuth()
  const isObserver = !!user?.is_observer
  return {
    isObserver,
    // Наблюдателю Каюта закрыта, даже если админ выдал грант.
    canCabin: !isObserver && (!!user?.can_access_cabin || user?.role === 'admin'),
    isAdmin: user?.role === 'admin',
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
  }
}

export function RequireAccess({ access }: { access: Access }) {
  const ctx = useAccessContext()
  if (isRouteVisible(access, ctx)) return <Outlet />
  if (access.kind === 'observerBlocked') {
    return access.redirectTo ? <Navigate to={access.redirectTo} replace /> : <ObserverBlocked />
  }
  return <Navigate to="/" replace />
}
