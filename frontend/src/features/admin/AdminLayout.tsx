import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { IconClose, IconMenu } from '../../components/icons'
import { useIsMobile } from '../../hooks/useIsMobile'
import { ADMIN_GROUPS, ADMIN_SECTIONS } from './sections'
import styles from './admin.module.css'

// Проверка role === 'admin' живёт в RequireAccess (см. features/app/routes.tsx,
// запись "/admin") — этот компонент отвечает только за subnav и Outlet.
export function AdminLayout() {
  const isMobile = useIsMobile()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)

  // На мобиле после перехода в раздел меню сворачивается само.
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  return (
    <div className={styles.adminLayout}>
      {isMobile && (
        <button
          type="button"
          className={styles.adminNavToggle}
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
        >
          {navOpen ? <IconClose size={18} /> : <IconMenu size={18} />}
          Разделы
        </button>
      )}
      <nav className={`${styles.adminNav} ${isMobile && navOpen ? styles.adminNavOpen : ''}`}>
        <div className={styles.adminNavList}>
          {ADMIN_GROUPS.map((group) => (
            <div key={group.key} className={styles.adminNavGroup}>
              <div className={styles.adminNavGroupTitle}>{group.label}</div>
              {ADMIN_SECTIONS.filter((section) => section.group === group.key).map((section) => (
                <NavLink
                  key={section.path}
                  to={`/admin/${section.path}`}
                  className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}
                  // Клик мышью оставляет фокус на ссылке, и :focus-within держит меню
                  // раскрытым после увода курсора. detail > 0 — только настоящий клик,
                  // активация с клавиатуры (detail === 0) фокус сохраняет.
                  onClick={(e) => { if (e.detail > 0) e.currentTarget.blur() }}
                >
                  {section.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
        <span className={styles.adminNavRail} aria-hidden="true">
          <IconMenu size={20} />
        </span>
      </nav>
      <div className={styles.adminContent}>
        <Outlet />
      </div>
    </div>
  )
}
