import type { ReactNode } from 'react'
import { StarSpark } from './StarSpark'
import styles from './emptyState.module.css'

interface Props {
  children: ReactNode
  /** inline — внутри списка или панели, block — пустой экран целиком. */
  size?: 'inline' | 'block'
  /** Брендовый глиф над текстом. По умолчанию выключен. */
  glyph?: boolean
  /** Кнопка действия под текстом. */
  action?: ReactNode
  className?: string
}

export function EmptyState({ children, size = 'inline', glyph = false, action, className = '' }: Props) {
  const cls = [styles.empty, styles[size], className].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {glyph && <StarSpark size={18} className={styles.glyph} />}
      <div>{children}</div>
      {action}
    </div>
  )
}
