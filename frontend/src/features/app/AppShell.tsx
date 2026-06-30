import { useEffect } from 'react'
import { wsClient } from '../../lib/wsClient'
import { Button } from '../../components/Button'
import { useAuth } from '../auth/AuthContext'
import styles from './appshell.module.css'

// Каркас приложения (Стадия 12, фаза 1). В следующих фазах тело заменяется на
// Telegram-раскладку: список чатов + чат-пейн, экраны Базы/Календаря/Профиля/Админки.
export function AppShell() {
  const { user, logout } = useAuth()

  // Реалтайм-соединение живёт, пока юзер залогинен (с авто-реконнектом).
  useEffect(() => {
    wsClient.start()
    return () => wsClient.stop()
  }, [])

  return (
    <div className={`col ${styles.shell}`}>
      <header className={styles.topbar}>
        <span className={styles.wordmark}>Аргонавтика</span>
        <div className={styles.spacer} />
        <span className={styles.user}>
          {user?.display_name}
          {user?.role === 'admin' && <span className={styles.adminTag}>admin</span>}
        </span>
        <Button variant="outline" onClick={() => void logout()}>Выйти</Button>
      </header>
      <main className={`grow center ${styles.body}`}>
        <div className={styles.placeholder}>
          <div className="label">Каркас готов</div>
          <p>
            Аутентификация, дизайн-система и реалтайм-соединение подключены.
            Дальше — список чатов, сообщения, треды, пины, медиа, база знаний,
            календарь, профиль и админка.
          </p>
        </div>
      </main>
    </div>
  )
}
