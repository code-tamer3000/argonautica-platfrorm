import type { ReactNode } from 'react'
import { Spinner } from '../../components/Spinner'
import { useAuth } from './AuthContext'
import { ChangePasswordScreen } from './ChangePasswordScreen'
import { LoginScreen } from './LoginScreen'
import { OfflineScreen } from './OfflineScreen'
import { SurveyScreen } from '../survey/SurveyScreen'

export function AuthGuard({ children }: { children: ReactNode }) {
  const { status, user } = useAuth()
  if (status === 'loading') {
    return (
      <div className="center" style={{ height: '100%' }}>
        <Spinner size={32} />
      </div>
    )
  }
  // Сетевая ошибка на бутстрапе и кэша user нет вообще — явный экран, не спиннер
  // и не логин (сессия не обязательно мертва, просто неизвестна, ARG-146).
  if (status === 'offline') return <OfflineScreen />
  if (status === 'anon' || !user) return <LoginScreen />
  if (user.must_change_password) return <ChangePasswordScreen />
  // Выпускная анкета перекрывает платформу целиком, пока не отправлена
  // (бэкенд отбивает то же самое в deps.get_current_active_user).
  if (user.survey_required) return <SurveyScreen />
  return <>{children}</>
}
