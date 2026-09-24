import { Button } from '../../components/Button'
import { StarSpark } from '../../components/StarSpark'
import { useAuth } from './AuthContext'
import styles from './auth.module.css'

// Холодный офлайн-старт без кэша профиля (первый офлайн-запуск либо кэш стёрт
// логаутом): бутстрап уже ретраит /me в фоне сам, кнопка просто будит ожидание
// пораньше вместо пятисекундной паузы (ARG-146).
export function OfflineScreen() {
  const { retryBootstrap } = useAuth()

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div>
          <div className={styles.brand}>
            <img className={styles.brandMark} src="/media/monogram.png" alt="" aria-hidden />
            <span className={styles.wordmark}>Аргонавтика</span>
          </div>
          <div className={styles.divider} aria-hidden>
            <span className={styles.rule} />
            <span className={styles.star}><StarSpark size={22} variant="icon" /></span>
            <span className={`${styles.rule} ${styles.ruleR}`} />
          </div>
        </div>
        <div className={styles.error}>Нет связи с сервером. Проверьте интернет и попробуйте снова.</div>
        <Button type="button" variant="gold" onClick={retryBootstrap}>
          Повторить
        </Button>
      </div>
    </div>
  )
}
