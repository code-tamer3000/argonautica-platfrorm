import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAdminIntakes } from '../../api/admin'
import { IconClose, IconMenu } from '../../components/icons'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useUiStore } from '../../stores/ui'
import { ADMIN_GROUPS, ADMIN_SECTIONS } from './sections'
import styles from './admin.module.css'

/** `YYYY-MM-DD` → «2 июня 2026». */
function intakeDate(startsOn: string): string {
  return new Date(`${startsOn}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Проверка role === 'admin' живёт в RequireAccess (см. features/app/routes.tsx,
// запись "/admin") — этот компонент отвечает только за subnav и Outlet.
export function AdminLayout() {
  const isMobile = useIsMobile()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)

  // «Текущий поток» (ARG-104) — общий контекст для Задачи/КБ/Чаты: задаёт поток по
  // умолчанию в списках и куда уходит репост новости. Селектор здесь один на всю
  // админку, а не на каждом экране — так его выбор переживает переход между разделами.
  const { data: intakes = [] } = useAdminIntakes()
  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const setCurrentIntakeId = useUiStore((s) => s.setAdminCurrentIntakeId)

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
        {intakes.length > 0 && (
          <div className={styles.formRow} style={{ maxWidth: 320 }}>
            <label htmlFor="admin_current_intake">Текущий поток</label>
            <select
              id="admin_current_intake"
              className={styles.input}
              value={currentIntakeId ?? 'all'}
              onChange={(e) =>
                setCurrentIntakeId(e.target.value === 'all' ? null : Number(e.target.value))
              }
            >
              <option value="all">Все потоки</option>
              {intakes.map((intake) => (
                <option key={intake.id} value={intake.id}>
                  Поток от {intakeDate(intake.starts_on)}
                </option>
              ))}
            </select>
          </div>
        )}
        <Outlet />
      </div>
    </div>
  )
}
