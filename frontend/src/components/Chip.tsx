import type { HTMLAttributes } from 'react'
import styles from './chip.module.css'

export type ChipKind = 'neutral' | 'accepted' | 'returned' | 'soon' | 'late' | 'unreviewed'

interface Props extends HTMLAttributes<HTMLSpanElement> {
  kind?: ChipKind
}

export function Chip({ kind = 'neutral', className = '', ...rest }: Props) {
  const cls = [styles.chip, kind !== 'neutral' && styles[kind], className].filter(Boolean).join(' ')
  return <span className={cls} {...rest} />
}
