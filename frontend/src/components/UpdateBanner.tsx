import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from './Button'
import styles from './updateBanner.module.css'

// Проверка новой версии сразу при фокусе вкладки + раз в 10 минут в фоне —
// иначе браузер сверяет service worker только при полной навигации, а SPA
// её почти никогда не делает, и обновление годами не долетает до вкладки.
const CHECK_INTERVAL_MS = 10 * 60 * 1000

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => void registration.update()
      setInterval(check, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  if (!needRefresh) return null

  return (
    <div className={styles.banner} role="status">
      <span className={styles.text}>Вышло обновление приложения</span>
      <Button
        variant="gold"
        className={styles.updateBtn}
        onClick={() => void updateServiceWorker(true)}
      >
        Обновить
      </Button>
      <button
        className={styles.dismiss}
        onClick={() => setNeedRefresh(false)}
        aria-label="Скрыть"
        title="Скрыть"
      >
        ✕
      </button>
    </div>
  )
}
