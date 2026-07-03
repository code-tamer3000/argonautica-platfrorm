import { useToasts } from '../stores/toast'
import { Avatar } from './Avatar'
import styles from './toasts.module.css'

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className={styles.wrap}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${styles.toast} ${t.kind === 'error' ? styles.error : ''} ${
            t.onClick ? styles.clickable : ''
          }`}
          onClick={() => {
            t.onClick?.()
            dismiss(t.id)
          }}
        >
          {t.title ? (
            <div className={styles.rich}>
              <Avatar name={t.avatarName ?? t.title} url={t.avatarUrl} size={38} />
              <div className={styles.richBody}>
                <div className={styles.richTitle}>{t.title}</div>
                <div className={styles.richText}>{t.text}</div>
              </div>
            </div>
          ) : (
            t.text
          )}
        </div>
      ))}
    </div>
  )
}
