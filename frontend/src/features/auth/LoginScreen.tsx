import { useState, type FormEvent } from 'react'
import { ApiError, isNetworkError } from '../../lib/apiClient'
import { Button } from '../../components/Button'
import { StarSpark } from '../../components/StarSpark'
import { useAuth } from './AuthContext'
import styles from './auth.module.css'

export function LoginScreen() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      if (isNetworkError(err)) {
        setError('Нет связи с сервером. Проверьте интернет и попробуйте снова.')
      } else {
        setError(err instanceof ApiError && err.status === 401 ? 'Неверный логин или пароль' : 'Не удалось войти')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div>
          <div className={styles.brand}>
            <img className={styles.brandMark} src="/media/monogram.png" alt="" aria-hidden />
            <span className={styles.wordmark}>Аргонавтика</span>
          </div>
          <div className={styles.tagline}>
            Система проявления<br />для людей с миссией
          </div>
          <div className={styles.divider} aria-hidden>
            <span className={styles.rule} />
            <span className={styles.star}><StarSpark size={16} /></span>
            <span className={`${styles.rule} ${styles.ruleR}`} />
          </div>
        </div>
        <div className={styles.field}>
          <label className="label" htmlFor="username">Логин</label>
          <input
            id="username"
            className={styles.input}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label className="label" htmlFor="password">Пароль</label>
          <input
            id="password"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <Button type="submit" variant="gold" disabled={busy || !username || !password}>
          {busy ? 'Вход…' : 'Войти'}
        </Button>
      </form>
    </div>
  )
}
