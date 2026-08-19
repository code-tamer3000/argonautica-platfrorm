import { useLocation } from 'react-router-dom'
import { UpdateBanner } from './components/UpdateBanner'
import { AppShell } from './features/app/AppShell'
import { AuthGuard } from './features/auth/AuthGuard'
import { OfertaScreen } from './features/oferta/OfertaScreen'

export function App() {
  const location = useLocation()
  // Публичная оферта (ARG-43) — единственный экран платформы вне авторизации:
  // intake-бот открывает его Telegram WebApp'ом до создания аккаунта участника.
  if (location.pathname === '/oferta') {
    return (
      <>
        <UpdateBanner />
        <OfertaScreen />
      </>
    )
  }
  return (
    <>
      <UpdateBanner />
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    </>
  )
}
