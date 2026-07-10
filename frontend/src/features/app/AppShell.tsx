import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { IconBook, IconCalendar, IconChat, IconDiary, IconGenkeys, IconNews, IconSettings, IconSupport, IconTasks, IconUser } from '../../components/icons'
import { StarSpark } from '../../components/StarSpark'
import { Toasts } from '../../components/Toasts'
import { useRealtime } from '../../hooks/useRealtime'
import { useOutbox } from '../../hooks/useOutbox'
import { wsClient } from '../../lib/wsClient'
import { ConnectionBanner } from './ConnectionBanner'
import { useAuth } from '../auth/AuthContext'
import { ChatLayout } from '../chat/ChatLayout'
import { CalendarView } from '../calendar/CalendarView'
import { CabinScreen } from '../cabin/CabinScreen'
import { KbList } from '../kb/KbList'
import { KbViewer } from '../kb/KbViewer'
import { TasksList } from '../tasks/TasksList'
import { TaskDetail } from '../tasks/TaskDetail'
import { ProfileScreen } from '../profile/ProfileScreen'
import { SupportScreen } from '../support/SupportScreen'
import { AdminLayout } from '../admin/AdminLayout'
import { AdminDynamics } from '../admin/AdminDynamics'
import { AdminJournal } from '../admin/AdminJournal'
import { AdminKb } from '../admin/AdminKb'
import { AdminTasks } from '../admin/AdminTasks'
import { AdminCalendar } from '../admin/AdminCalendar'
import { AdminStickers } from '../admin/AdminStickers'
import { AdminUsers } from '../admin/AdminUsers'
import { AdminFeedback } from '../admin/AdminFeedback'
import { AdminFaq } from '../admin/AdminFaq'
import { AdminBroadcast } from '../admin/AdminBroadcast'
import { AdminCabin } from '../admin/AdminCabin'
import { NotificationBell } from './NotificationBell'
import { ProfileMenu } from './ProfileMenu'
import { useNavBadges } from './useNavBadges'
import { Spinner } from '../../components/Spinner'
import styles from './appshell.module.css'

// Раздел «Генные ключи» тянет 64 markdown-файла — держим его в отдельном чанке,
// чтобы не раздувать основной бандл (грузится только при заходе в раздел).
const GeneKeysScreen = lazy(() =>
  import('../genkeys/GeneKeysScreen').then((m) => ({ default: m.GeneKeysScreen })),
)
const KbBookReader = lazy(() =>
  import('../kb/book/KbBookReader').then((m) => ({ default: m.KbBookReader })),
)

export function AppShell() {
  const { user } = useAuth()
  const location = useLocation()
  const badges = useNavBadges()

  // Каюта закрыта по умолчанию — видна, только если админ выдал доступ (у самого
  // админа доступ есть всегда). Прячем и пункт навигации, и маршрут.
  const canCabin = user?.can_access_cabin || user?.role === 'admin'

  // Реалтайм-соединение живёт, пока юзер залогинен (авто-реконнект внутри).
  useEffect(() => {
    wsClient.start()
    return () => wsClient.stop()
  }, [])

  // Проводка WS-событий в кэш (один раз в корне).
  useRealtime()

  // Outbox: отправка сообщений с переживанием офлайна/перезагрузки (один раз в корне).
  useOutbox()

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

  // Мобильный таб-бар прокручивается горизонтально, когда вкладок больше, чем
  // влезает на экран — но по умолчанию это никак не видно и люди не догадываются
  // свайпать. Подсвечиваем «есть ещё» краевыми fade-градиентами: ставим на nav
  // data-scroll-start/end, когда с той стороны есть скрытый контент. Градиенты
  // рисует CSS (::before/::after), а лёгкое «покачивание» бара при первом показе
  // (см. navHint ниже) намекает на жест.
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const update = () => {
      const overflow = nav.scrollWidth - nav.clientWidth
      // 2px допуск на субпиксельные округления.
      const atStart = nav.scrollLeft <= 2
      const atEnd = nav.scrollLeft >= overflow - 2
      nav.dataset.scrollStart = String(overflow > 2 && !atStart)
      nav.dataset.scrollEnd = String(overflow > 2 && !atEnd)
    }
    update()

    // Одноразовый (за сессию) намёк-«покачивание», если бар реально
    // прокручивается. Только на мобиле — на десктопе сайднав вертикальный и
    // никогда не переполняется по X. Класс снимаем после проигрывания, чтобы не
    // блокировать transform клавиатуры (translateY при data-kb='open').
    if (
      !isDesktop &&
      nav.scrollWidth - nav.clientWidth > 2 &&
      !sessionStorage.getItem('navScrollHintShown')
    ) {
      sessionStorage.setItem('navScrollHintShown', '1')
      nav.classList.add(styles.navHint)
      const done = () => nav.classList.remove(styles.navHint)
      nav.addEventListener('animationend', done, { once: true })
    }

    nav.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(nav)
    return () => {
      nav.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [user?.role, canCabin, isDesktop])

  return (
    <div className={`col ${styles.shell}`}>
      <header className={styles.topbar}>
        <span className={styles.brand}>
          <img className={styles.brandMark} src="/media/monogram.png" alt="" aria-hidden />
          <span className={styles.wordmark}>Аргонавтика</span>
          <span className={styles.brandStar} aria-hidden><StarSpark size={12} /></span>
        </span>
        <div className={styles.spacer} />
        <NotificationBell />
        <ProfileMenu />
      </header>
      <ConnectionBanner />
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
          <NavLink to="/tasks" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconTasks /></span>
            <span className={styles.navLabel}>Задачи</span>
            {badges.tasks > 0 && <span className={styles.navBadge}>{badges.tasks > 99 ? '99+' : badges.tasks}</span>}
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconCalendar /></span>
            <span className={styles.navLabel}>Календарь</span>
          </NavLink>
          <NavLink to="/genkeys" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
            <span className={styles.navIcon}><IconGenkeys /></span>
            <span className={styles.navLabel}>Генные замки</span>
          </NavLink>
          {canCabin && (
            <NavLink to="/cabin" className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}>
              <span className={styles.navIcon}><IconDiary /></span>
              <span className={styles.navLabel}>Каюта</span>
            </NavLink>
          )}
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
            <Route
              path="/kb/read/:itemId/:assetId"
              element={
                <Suspense fallback={<div className="center grow"><Spinner /></div>}>
                  <KbBookReader />
                </Suspense>
              }
            />
            <Route path="/kb/:itemId" element={<KbViewer />} />
            <Route path="/tasks" element={<TasksList />} />
            <Route path="/tasks/:taskId" element={<TaskDetail />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route
              path="/genkeys"
              element={
                <Suspense fallback={<div className="center grow"><Spinner /></div>}>
                  <GeneKeysScreen />
                </Suspense>
              }
            />
            <Route path="/cabin" element={canCabin ? <CabinScreen /> : <Navigate to="/" replace />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/support" element={<SupportScreen />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="dynamics" element={<AdminDynamics />} />
              <Route path="journal" element={<AdminJournal />} />
              <Route path="cabin" element={<AdminCabin />} />
              <Route path="kb" element={<AdminKb />} />
              <Route path="tasks" element={<AdminTasks />} />
              <Route path="calendar" element={<AdminCalendar />} />
              <Route path="stickers" element={<AdminStickers />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="feedback" element={<AdminFeedback />} />
              <Route path="faq" element={<AdminFaq />} />
              <Route path="broadcast" element={<AdminBroadcast />} />
              <Route index element={<Navigate to="dynamics" replace />} />
            </Route>
          </Routes>
        </main>
      </div>
      <Toasts />
    </div>
  )
}
