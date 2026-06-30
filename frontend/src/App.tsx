import { AppShell } from './features/app/AppShell'
import { AuthGuard } from './features/auth/AuthGuard'

export function App() {
  return (
    <AuthGuard>
      <AppShell />
    </AuthGuard>
  )
}
