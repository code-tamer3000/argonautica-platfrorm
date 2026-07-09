import { useConnectionStatus } from '../../hooks/useConnectionStatus'
import styles from './appshell.module.css'

// Тонкая полоса под топбаром, снимающая догадку «это у меня лагает или у них».
// Показывается только при проблеме: офлайн или затянувшийся реконнект. При
// восстановлении связи исчезает сама.
export function ConnectionBanner() {
  const state = useConnectionStatus()
  if (state === 'online') return null

  const offline = state === 'offline'
  return (
    <div
      className={`${styles.connBanner} ${offline ? styles.connOffline : styles.connReconnecting}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.connDot} />
      {offline
        ? 'Нет соединения. Сообщения отправятся, когда сеть вернётся.'
        : 'Плохое соединение — восстанавливаем связь…'}
    </div>
  )
}
