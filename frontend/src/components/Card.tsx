import type { HTMLAttributes } from 'react'
import styles from './card.module.css'

interface CardOptions {
  /** Компактные отступы --space-3 --space-4 вместо --space-4 --space-5. */
  compact?: boolean
  /** Карточка кликабельна: курсор, переход, подсветка границы на ховере. */
  interactive?: boolean
  /** Золотая граница — карточка сама просит внимания. */
  accent?: boolean
  className?: string
}

/*
 * Карточку вешают не только на <div>: в списках это <Link>, в каюте <article>.
 * Полиморфный компонент ради этого не нужен — достаточно отдать классы, а
 * источник правды всё равно один (card.module.css).
 */
export function cardClass({ compact, interactive, accent, className = '' }: CardOptions = {}) {
  return [
    styles.card,
    compact && styles.compact,
    interactive && styles.interactive,
    accent && styles.accent,
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

type Props = HTMLAttributes<HTMLDivElement> & Omit<CardOptions, 'className'>

export function Card({ compact, interactive, accent, className = '', ...rest }: Props) {
  return <div className={cardClass({ compact, interactive, accent, className })} {...rest} />
}
