import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AdminLayout } from './AdminLayout'
import { ADMIN_DEFAULT_PATH, visibleSections } from './sections'

// Точка входа для lazy-чанка админки (см. features/app/routes.tsx, запись
// "/admin") — весь субдерево маршрутов и статические импорты 13 экранов живут
// здесь, а не в основном бандле.
export function AdminRoutes() {
  const { user } = useAuth()
  const sections = visibleSections(!!user?.is_navigator)
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        {sections.map((section) => (
          <Route key={section.path} path={section.path} element={<section.Component />} />
        ))}
        <Route index element={<Navigate to={ADMIN_DEFAULT_PATH} replace />} />
      </Route>
    </Routes>
  )
}
