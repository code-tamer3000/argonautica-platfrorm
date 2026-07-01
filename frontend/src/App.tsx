import { UpdateBanner } from './components/UpdateBanner'
import { AppShell } from './features/app/AppShell'
import { AuthGuard } from './features/auth/AuthGuard'

export function App() {
  return (
    <>
      <UpdateBanner />
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    </>
  )
}
