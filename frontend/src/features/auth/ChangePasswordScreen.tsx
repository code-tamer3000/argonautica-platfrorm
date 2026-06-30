import { useState, type FormEvent } from 'react'
import { ApiError } from '../../lib/apiClient'
import { Button } from '../../components/Button'
import { changePassword } from './api'
import { useAuth } from './AuthContext'
import styles from './auth.module.css'

export function ChangePasswordScreen() {
  const { refreshMe, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 8) {
      setError('Новый пароль — минимум 8 символов')
      return
    }
    setBusy(true)
    try {
      await changePassword(current, next)
      await refreshMe()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? 'Текущий пароль неверен' : 'Не удалось сменить пароль')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.wordmark}>Смена пароля</div>
        <p className={styles.hint}>Вам выдан временный пароль — задайте постоянный, чтобы продолжить.</p>
        <div className={styles.field}>
          <label className="label" htmlFor="current">Текущий (временный) пароль</label>
          <input id="current" className={styles.input} type="password" value={current}
            onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </div>
        <div className={styles.field}>
          <label className="label" htmlFor="next">Новый пароль</label>
          <input id="next" className={styles.input} type="password" autoComplete="new-password" value={next}
            onChange={(e) => setNext(e.target.value)} />
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <Button type="submit" variant="gold" disabled={busy || !current || !next}>
          {busy ? 'Сохранение…' : 'Сохранить'}
        </Button>
        <Button type="button" variant="outline" onClick={() => void logout()}>Выйти</Button>
      </form>
    </div>
  )
}
