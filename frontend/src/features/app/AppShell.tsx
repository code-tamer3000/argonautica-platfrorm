import { useEffect, useLayoutEffect, useRef } from 'react'
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
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)

  // Форсируем перерисовку таб-бара сразу при смене маршрута. На мобиле (WebView/
  // iOS Safari) смена активного класса у NavLink НЕ красится до следующего касания —
  // подсветка «залипала». Микро-тогл opacity + reflow заставляют браузер
  // перерисовать содержимое (в т.ч. индикатор ::before) в этом же кадре.
  useLayoutEffect(() => {
    const el = navRef.current
    if (!el) return
    el.style.opacity = '0.999'
    void el.offsetHeight // принудительный reflow, чтобы применилось до следующего кадра
    requestAnimationFrame(() => {
      if (navRef.current) navRef.current.style.opacity = ''
    })
  }, [location.pathname])

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
        <nav ref={navRef} className={styles.sidenav}>
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
