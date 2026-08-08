import { useId } from 'react'
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import styles from './input.module.css'

interface BaseProps {
  label?: string
  error?: string
  hint?: string
}

type Props =
  | (BaseProps & { multiline?: false } & InputHTMLAttributes<HTMLInputElement>)
  | (BaseProps & { multiline: true } & TextareaHTMLAttributes<HTMLTextAreaElement>)

export function Input({ label, error, hint, id, className = '', multiline, ...rest }: Props) {
  const autoId = useId()
  const inputId = id ?? autoId
  const fieldClass = `${styles.input} ${className}`.trim()

  return (
    <div className={styles.field}>
      {label && (
        <label className="label" htmlFor={inputId}>
          {label}
        </label>
      )}
      {multiline ? (
        <textarea id={inputId} className={fieldClass} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input id={inputId} className={fieldClass} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {error ? <div className={styles.error}>{error}</div> : hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  )
}
