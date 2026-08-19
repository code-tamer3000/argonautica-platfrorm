import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAdminIntakes } from '../../api/admin'
import { useRooms } from '../../api/rooms'
import { StarSpark } from '../../components/StarSpark'
import { Toasts } from '../../components/Toasts'
import { useRealtime } from '../../hooks/useRealtime'
import { useOutbox } from '../../hooks/useOutbox'
import { wsClient } from '../../lib/wsClient'
import { useUiStore } from '../../stores/ui'
import { ConnectionBanner } from './ConnectionBanner'
import { NotificationBell } from './NotificationBell'
import { WelcomePopup } from './WelcomePopup'
import { ProfileMenu } from './ProfileMenu'
import { RequireAccess, isRouteVisible, useAccessContext } from './RequireAccess'
import { routes } from './routes'
import { useNavBadges } from './useNavBadges'
import styles from './appshell.module.css'

/** `YYYY-MM-DD` → «2 июня 2026». */
function intakeDate(startsOn: string): string {
  return new Date(`${startsOn}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Селектор «текущий поток» (ARG-104): раньше жил только внутри /admin
// (AdminLayout) — виден и переключаем оттуда же, а его эффект (фильтрация
// Задачи/КБ/Чаты, целевой поток репоста) читается из общего стора ВЕЗДЕ, в т.ч.
// вне /admin. По многочисленным жалобам вынесен в шапку целиком: должен быть
// виден и переключаем с любого экрана, не только из админки.
function CurrentIntakeSwitcher() {
  const { data: intakes = [] } = useAdminIntakes()
  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const setCurrentIntakeId = useUiStore((s) => s.setAdminCurrentIntakeId)
  if (intakes.length === 0) return null
  return (
    <select
      className={styles.intakeSwitcher}
      value={currentIntakeId ?? 'all'}
      onChange={(e) => setCurrentIntakeId(e.target.value === 'all' ? null : Number(e.target.value))}
      title="Текущий поток — фильтрует Задачи/КБ/Чаты и целевой поток репоста в новости"
    >
      <option value="all">Все потоки</option>
      {intakes.map((intake) => (
        <option key={intake.id} value={intake.id}>
          Поток от {intakeDate(intake.starts_on)}
        </option>
      ))}
    </select>
  )
}

export function AppShell() {
  const location = useLocation()
  const badges = useNavBadges()
  const accessCtx = useAccessContext()
  const isObserver = accessCtx.isObserver

  // Для подсветки нава: /news резолвится в /chats/:id или /diaries/:id, и без
  // знания id новостной комнаты её адрес неотличим от обычной (см. routes.tsx).
  // Новостной канал не singleton (ARG-104) — с выбранным потоком резолвим ИМЕННО
  // его новости, иначе первый найденный (см. NewsRedirect в routes.tsx — та же логика).
  const { data: rooms } = useRooms()
  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const newsRoomId = useMemo(() => {
    const preferred = accessCtx.isAdmin && currentIntakeId != null
      ? rooms?.find((r) => r.is_news && r.intake_id === currentIntakeId)
      : undefined
    return (preferred ?? rooms?.find((r) => r.is_news))?.id ?? null
  }, [rooms, accessCtx.isAdmin, currentIntakeId])

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
  }, [location.pathname, accessCtx.isAdmin])

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
  }, [accessCtx.isAdmin, accessCtx.canCabin, isDesktop])

  return (
    <div className={`col ${styles.shell}`}>
      <header className={styles.topbar}>
        <span className={styles.brand}>
          <img className={styles.brandMark} src="/media/monogram.png" alt="" aria-hidden />
          <span className={styles.wordmark}>Аргонавтика</span>
          <span className={styles.brandStar} aria-hidden><StarSpark size={16} variant="icon" /></span>
        </span>
        <div className={styles.spacer} />
        {accessCtx.isAdmin && <CurrentIntakeSwitcher />}
        {!isObserver && <NotificationBell />}
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
          {routes.filter((cfg) => !cfg.hidden && isRouteVisible(cfg.access, accessCtx)).map((cfg) => {
            const badgeValue = cfg.badgeKey ? badges[cfg.badgeKey] : 0
            const content = (
              <>
                <span className={styles.navIcon}><cfg.icon /></span>
                <span className={styles.navLabel}>{cfg.label}</span>
                {badgeValue > 0 && <span className={styles.navBadge}>{badgeValue > 99 ? '99+' : badgeValue}</span>}
              </>
            )
            if (cfg.isNavActive) {
              const active = cfg.isNavActive({ pathname: location.pathname, newsRoomId })
              return (
                <Link
                  key={cfg.path}
                  to={cfg.path}
                  className={active ? styles.navLinkActive : styles.navLink}
                  aria-current={active ? 'page' : undefined}
                >
                  {content}
                </Link>
              )
            }
            return (
              <NavLink
                key={cfg.path}
                to={cfg.path}
                end={cfg.end}
                className={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}
              >
                {content}
              </NavLink>
            )
          })}
        </nav>
        <main className={styles.content}>
          <Routes>
            {routes.map((cfg) => (
              <Route key={cfg.path} element={<RequireAccess access={cfg.access} />}>
                {cfg.renderRoutes ? cfg.renderRoutes() : (
                  <>
                    {cfg.Component && <Route path={cfg.path} element={<cfg.Component />} />}
                    {cfg.children?.map((child) => (
                      <Route key={child.path} path={child.path} element={<child.Component />} />
                    ))}
                  </>
                )}
              </Route>
            ))}
          </Routes>
        </main>
      </div>
      {!isObserver && <WelcomePopup />}
      <Toasts />
    </div>
  )
}
