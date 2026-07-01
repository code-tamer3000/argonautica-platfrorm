import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import styles from './admin.module.css'

export function AdminLayout() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className={styles.adminLayout}>
      <nav className={styles.adminNav}>
        <NavLink to="/admin/kb" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          База знаний
        </NavLink>
        <NavLink to="/admin/calendar" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          Календарь
        </NavLink>
        <NavLink to="/admin/stickers" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          Стикеры
        </NavLink>
        <NavLink to="/admin/users" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          Пользователи
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
