import type { ReactNode } from 'react'
import { BackButton } from './BackButton'
import styles from './pageHeader.module.css'

// Общая шапка экрана: кнопка «Назад» + заголовок + опциональные действия справа.
// Кнопку рисует BackButton — на первом экране сессии она сама себя скрывает.
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageHeaderTitle}>
        <BackButton />
        <h1>{title}</h1>
      </div>
      {children && <div className={styles.pageHeaderActions}>{children}</div>}
    </div>
  )
}
