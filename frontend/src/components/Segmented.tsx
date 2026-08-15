import styles from './segmented.module.css'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  /** Подпись группы для скринридера. */
  label?: string
}

export function Segmented<T extends string>({ options, value, onChange, className = '', label }: Props<T>) {
  return (
    <div className={`${styles.segmented} ${className}`.trim()} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? `${styles.seg} ${styles.segActive}` : styles.seg}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
