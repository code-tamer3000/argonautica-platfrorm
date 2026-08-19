import { useEffect, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { IconClose, IconMenu } from '../../components/icons'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useAuth } from '../auth/AuthContext'
import { ADMIN_GROUPS, ADMIN_SECTIONS } from './sections'
import styles from './admin.module.css'

export function AdminLayout() {
  const { user } = useAuth()
  const isMobile = useIsMobile()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)

  // На мобиле после перехода в раздел меню сворачивается само.
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  if (user?.role !== 'admin') return <Navigate to="/" replace />

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
        {ADMIN_GROUPS.map((group) => (
          <div key={group.key} className={styles.adminNavGroup}>
            <div className={styles.adminNavGroupTitle}>{group.label}</div>
            {ADMIN_SECTIONS.filter((section) => section.group === group.key).map((section) => (
              <NavLink
                key={section.path}
                to={`/admin/${section.path}`}
                className={({ isActive }) => isActive ? styles.adminNavActive : styles.adminNavLink}
              >
                {section.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className={styles.adminContent}>
        <Outlet />
      </div>
    </div>
  )
}
