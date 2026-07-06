import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import styles from './admin.module.css'

export function AdminLayout() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className={styles.adminLayout}>
      <nav className={styles.adminNav}>
        <NavLink to="/admin/dynamics" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          Динамика
        </NavLink>
        <NavLink to="/admin/cabin" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          Каюта
        </NavLink>
        <NavLink to="/admin/kb" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          База знаний
        </NavLink>
        <NavLink to="/admin/tasks" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          Задачи
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
        <NavLink to="/admin/feedback" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          Обращения
        </NavLink>
        <NavLink to="/admin/faq" className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}>
          FAQ
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
