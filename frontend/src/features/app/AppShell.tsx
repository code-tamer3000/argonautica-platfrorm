import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Toasts } from '../../components/Toasts'
import { useRealtime } from '../../hooks/useRealtime'
import { wsClient } from '../../lib/wsClient'
import { useAuth } from '../auth/AuthContext'
import { ChatLayout } from '../chat/ChatLayout'
import { CalendarView } from '../calendar/CalendarView'
import { KbList } from '../kb/KbList'
import { KbViewer } from '../kb/KbViewer'
import { ProfileScreen } from '../profile/ProfileScreen'
import { AdminLayout } from '../admin/AdminLayout'
import { AdminKb } from '../admin/AdminKb'
import { AdminCalendar } from '../admin/AdminCalendar'
import { AdminStickers } from '../admin/AdminStickers'
import { AdminUsers } from '../admin/AdminUsers'
import styles from './appshell.module.css'

export function AppShell() {
  const { user, logout } = useAuth()

  // Реалтайм-соединение живёт, пока юзер залогинен (авто-реконнект внутри).
  useEffect(() => {
    wsClient.start()
    return () => wsClient.stop()
  }, [])

  // Проводка WS-событий в кэш (один раз в корне).
  useRealtime()

  return (
    <div className={`col ${styles.shell}`}>
      <header className={styles.topbar}>
        <span className={styles.wordmark}>Аргонавтика</span>
        <div className={styles.spacer} />
        <span className={styles.user}>
          {user?.display_name}
          {user?.role === 'admin' && <span className={styles.adminTag}>admin</span>}
        </span>
        <Button variant="outline" onClick={() => void logout()}>Выйти</Button>
      </header>
      <div className={styles.body}>
        <nav className={styles.sidenav}>
          <NavLink to="/" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink} end>
            <span className={styles.navIcon}>💬</span> Чат
          </NavLink>
          <NavLink to="/kb" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}>📚</span> База знаний
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}>📅</span> Календарь
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}>👤</span> Профиль
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
              <span className={styles.navIcon}>⚙️</span> Управление
            </NavLink>
          )}
        </nav>
        <main className={styles.content}>
          <Routes>
            <Route path="/" element={<ChatLayout />} />
            <Route path="/kb" element={<KbList />} />
            <Route path="/kb/:itemId" element={<KbViewer />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="kb" element={<AdminKb />} />
              <Route path="calendar" element={<AdminCalendar />} />
              <Route path="stickers" element={<AdminStickers />} />
              <Route path="users" element={<AdminUsers />} />
              <Route index element={<Navigate to="kb" replace />} />
            </Route>
          </Routes>
        </main>
      </div>
      <Toasts />
    </div>
  )
}
