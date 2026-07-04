import styles from './progressRing.module.css'

interface Props {
  /** Доля 0..1; null — индикатор без процента (крутится непрерывно). */
  progress: number | null
  size?: number
}

/**
 * Круговой индикатор загрузки поверх медиа. Если доля известна — рисуем дугу и %,
 * иначе крутящееся кольцо (indeterminate). Используется, пока файл тянется с сервера.
 */
export function ProgressRing({ progress, size = 44 }: Props) {
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const determinate = progress != null
  const pct = determinate ? Math.round(progress * 100) : 0

  return (
    <span className={styles.wrap} role="progressbar" aria-label="Загрузка медиа">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={determinate ? undefined : styles.spin}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(0,0,0,0.28)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={determinate ? c * (1 - progress) : c * 0.7}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {determinate && <span className={styles.pct}>{pct}%</span>}
    </span>
  )
}
