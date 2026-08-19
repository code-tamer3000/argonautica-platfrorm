import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBack } from './icons'
import styles from './pageHeader.module.css'

// Общая шапка экрана: кнопка «Назад» (history.back) + заголовок + опциональные
// действия справа. `navigate(-1)` всегда доступна — при пустой истории браузер
// просто остаётся на месте, определять «а есть ли куда возвращаться» не пытаемся.
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  const navigate = useNavigate()

  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageHeaderTitle}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => navigate(-1)}
          title="Назад"
          aria-label="Назад"
        >
          <IconBack size={20} />
        </button>
        <h1>{title}</h1>
      </div>
      {children && <div className={styles.pageHeaderActions}>{children}</div>}
    </div>
  )
}
