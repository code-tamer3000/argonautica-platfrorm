import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Button } from '../../components/Button'
import { IconBook, IconCalendar, IconChat, IconDiary, IconNews, IconSettings, IconSupport, IconUser } from '../../components/icons'
import { Toasts } from '../../components/Toasts'
import { useRealtime } from '../../hooks/useRealtime'
import { wsClient } from '../../lib/wsClient'
import { useAuth } from '../auth/AuthContext'
import { ChatLayout } from '../chat/ChatLayout'
import { CalendarView } from '../calendar/CalendarView'
import { CabinScreen } from '../cabin/CabinScreen'
import { KbList } from '../kb/KbList'
import { KbViewer } from '../kb/KbViewer'
import { ProfileScreen } from '../profile/ProfileScreen'
import { SupportScreen } from '../support/SupportScreen'
import { AdminLayout } from '../admin/AdminLayout'
import { AdminDynamics } from '../admin/AdminDynamics'
import { AdminKb } from '../admin/AdminKb'
import { AdminCalendar } from '../admin/AdminCalendar'
import { AdminStickers } from '../admin/AdminStickers'
import { AdminUsers } from '../admin/AdminUsers'
import { AdminFeedback } from '../admin/AdminFeedback'
import { AdminFaq } from '../admin/AdminFaq'
import { AdminCabin } from '../admin/AdminCabin'
import { NotificationBell } from './NotificationBell'
import { useNavBadges } from './useNavBadges'
import styles from './appshell.module.css'

export function AppShell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const badges = useNavBadges()

  // Реалтайм-соединение живёт, пока юзер залогинен (авто-реконнект внутри).
  useEffect(() => {
    wsClient.start()
    return () => wsClient.stop()
  }, [])

  // Проводка WS-событий в кэш (один раз в корне).
  useRealtime()

  // «Живой» золотой индикатор: один общий элемент, который переезжает под
  // активную вкладку (а не отдельная подсветка на каждой ссылке). Меряем
  // геометрию активного пункта и позиционируем glider — CSS-transition даёт
  // эффект «пробегающей» золотой штучки между вкладками. Работает и для
  // вертикального сайднава (десктоп), и для горизонтального таб-бара (мобила):
  // берём offsetLeft/Top/Width/Height относительно nav (его offsetParent).
  const navRef = useRef<HTMLElement>(null)
  const [glider, setGlider] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // Десктоп vs мобила решает поведение индикатора (см. ниже): на десктопе он не
  // «перебегает» между вкладками, а появляется прямо в целевом разделе; на мобиле
  // тонкая черта плавно скользит по низу таб-бара.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 769px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)')
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]')
      if (!active) return setGlider(null)
      setGlider({ x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight })
    }
    measure()
    // Пересчёт при смене ориентации/раскладки (десктоп↔мобила, ресайз).
    const ro = new ResizeObserver(measure)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [location.pathname, user?.role])

  return (
    <div className={`col ${styles.shell}`}>
      <header className={styles.topbar}>
        <span className={styles.wordmark}>Аргонавтика</span>
        <div className={styles.spacer} />
        <NotificationBell />
        <span className={styles.user}>
          {user?.display_name}
          {user?.role === 'admin' && <span className={styles.adminTag}>admin</span>}
        </span>
        <Button variant="outline" onClick={() => void logout()}>Выйти</Button>
      </header>
      <div className={styles.body}>
        <nav ref={navRef} className={styles.sidenav}>
          {glider && (
            <span
              // На десктопе key меняется на каждый переход → индикатор
              // перемонтируется и заново проигрывает анимацию «вылезания» в целевом
              // разделе (не едет через весь экран). На мобиле key постоянный →
              // элемент живёт и его черта плавно скользит по низу бара.
              key={isDesktop ? location.pathname : 'glider'}
              className={styles.navGlider}
              style={{ transform: `translate(${glider.x}px, ${glider.y}px)`, width: glider.w, height: glider.h }}
            />
          )}
          <NavLink to="/" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink} end>
            <span className={styles.navIcon}><IconChat /></span>
            <span className={styles.navLabel}>Рубка</span>
            {badges.rubka > 0 && <span className={styles.navBadge}>{badges.rubka > 99 ? '99+' : badges.rubka}</span>}
          </NavLink>
          <NavLink to="/news" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconNews /></span>
            <span className={styles.navLabel}>Новости</span>
            {badges.news > 0 && <span className={styles.navBadge}>{badges.news > 99 ? '99+' : badges.news}</span>}
          </NavLink>
          <NavLink to="/kb" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconBook /></span>
            <span className={styles.navLabel}>База знаний</span>
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconCalendar /></span>
            <span className={styles.navLabel}>Календарь</span>
          </NavLink>
          <NavLink to="/cabin" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconDiary /></span>
            <span className={styles.navLabel}>Каюта</span>
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconUser /></span>
            <span className={styles.navLabel}>Профиль</span>
          </NavLink>
          <NavLink to="/support" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconSupport /></span>
            <span className={styles.navLabel}>Техподдержка</span>
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
            <Route path="/" element={<ChatLayout key="rubka" />} />
            <Route path="/news" element={<ChatLayout key="news" autoOpen="news" />} />
            <Route path="/kb" element={<KbList />} />
            <Route path="/kb/:itemId" element={<KbViewer />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/cabin" element={<CabinScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/support" element={<SupportScreen />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="dynamics" element={<AdminDynamics />} />
              <Route path="cabin" element={<AdminCabin />} />
              <Route path="kb" element={<AdminKb />} />
              <Route path="calendar" element={<AdminCalendar />} />
              <Route path="stickers" element={<AdminStickers />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="feedback" element={<AdminFeedback />} />
              <Route path="faq" element={<AdminFaq />} />
              <Route index element={<Navigate to="dynamics" replace />} />
            </Route>
          </Routes>
        </main>
      </div>
      <Toasts />
    </div>
  )
}
