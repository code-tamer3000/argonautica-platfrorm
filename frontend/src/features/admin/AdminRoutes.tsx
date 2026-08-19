import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './AdminLayout'
import { ADMIN_DEFAULT_PATH, ADMIN_SECTIONS } from './sections'

// Точка входа для lazy-чанка админки (см. features/app/routes.tsx, запись
// "/admin") — весь субдерево маршрутов и статические импорты 13 экранов живут
// здесь, а не в основном бандле.
export function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        {ADMIN_SECTIONS.map((section) => (
          <Route key={section.path} path={section.path} element={<section.Component />} />
        ))}
        <Route index element={<Navigate to={ADMIN_DEFAULT_PATH} replace />} />
      </Route>
    </Routes>
  )
}
