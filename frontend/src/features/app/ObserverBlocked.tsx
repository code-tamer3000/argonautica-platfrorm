import { NavLink } from 'react-router-dom'
import { IconBook } from '../../components/icons'
import styles from './appshell.module.css'

/**
 * Заглушка для наблюдателя, попавшего на закрытый раздел (напр. /tasks по прямой
 * ссылке или после перевода в наблюдатели во время сессии). Вместо тупика —
 * понятное объяснение и ссылка обратно на материалы. Бэкенд такие разделы всё
 * равно закрывает (403); это просто дружелюбный экран, а не защита.
 */
export function ObserverBlocked() {
  return (
    <div className={`center grow col ${styles.observerBlocked}`}>
      <span className={styles.observerBlockedIcon} aria-hidden>
        <IconBook />
      </span>
      <h2 className={styles.observerBlockedTitle}>Режим наблюдателя</h2>
      <p className={styles.observerBlockedText}>
        Этот раздел недоступен. Вам открыты материалы платформы: База знаний
        и Генные замки.
      </p>
      <NavLink to="/kb" className={styles.observerBlockedLink}>
        Перейти к Базе знаний
      </NavLink>
    </div>
  )
}
