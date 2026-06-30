import { useToasts } from '../stores/toast'
import styles from './toasts.module.css'

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className={styles.wrap}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${styles.toast} ${t.kind === 'error' ? styles.error : ''}`}
          onClick={() => dismiss(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
