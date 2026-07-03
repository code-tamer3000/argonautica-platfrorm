import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Button } from '../../components/Button'
import { IconBook, IconCalendar, IconChat, IconNews, IconSettings, IconUser } from '../../components/icons'
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

  // Корневой раздел из пути (первый сегмент). Используем как key для <nav>: при
  // смене раздела React пересоздаёт узлы таб-бара, а не мутирует существующие.
  // Это единственное, что надёжно чинит «залипание» подсветки на мобиле —
  // .sidenav у нас position:fixed, а мобильные браузеры (iOS Safari) НЕ
  // перерисовывают fixed-элемент при обновлении класса до следующего касания.
  // Свежевставленные DOM-ноды браузер обязан отрисовать сразу.
  const section = useLocation().pathname.split('/')[1] || 'chat'

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
        <nav key={section} className={styles.sidenav}>
          <NavLink to="/" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink} end>
            <span className={styles.navIcon}><IconChat /></span>
            <span className={styles.navLabel}>Рубка</span>
          </NavLink>
          <NavLink to="/news" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconNews /></span>
            <span className={styles.navLabel}>Новости</span>
          </NavLink>
          <NavLink to="/kb" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconBook /></span>
            <span className={styles.navLabel}>База знаний</span>
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconCalendar /></span>
            <span className={styles.navLabel}>Календарь</span>
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconUser /></span>
            <span className={styles.navLabel}>Профиль</span>
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
              <span className={styles.navIcon}><IconSettings /></span>
              <span className={styles.navLabel}>Управление</span>
            </NavLink>
          )}
        </nav>
        <main className={styles.content}>
          <Routes>
            <Route path="/" element={<ChatLayout />} />
            <Route path="/news" element={<ChatLayout autoOpen="news" />} />
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
