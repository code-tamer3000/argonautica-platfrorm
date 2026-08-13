import type { HTMLAttributes } from 'react'
import styles from './badge.module.css'

type Tone = 'neutral' | 'accent'

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

export function Badge({ tone = 'neutral', className = '', ...rest }: Props) {
  const cls = [styles.badge, tone === 'accent' && styles.accent, className].filter(Boolean).join(' ')
  return <span className={cls} {...rest} />
}
