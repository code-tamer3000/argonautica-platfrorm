import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { IconUser } from '../../components/icons'
import { useAuth } from '../auth/AuthContext'
import styles from './profileMenu.module.css'

// Меню профиля в шапке. Пользователь с платформы не «выходит» в обычном сценарии,
// поэтому кнопку «Выйти» прячем в дропдаун за аватаром (нужна в основном разработчику),
// а на первом плане — переход в профиль.
export function ProfileMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Закрытие по клику вне меню.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!user) return null

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-label="Профиль"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={user.display_name} url={user.avatar_url} size={30} />
        {user.role === 'admin' && <span className={styles.adminDot} aria-hidden />}
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.head}>
            <Avatar name={user.display_name} url={user.avatar_url} size={38} />
            <div className={styles.headText}>
              <span className={styles.name}>{user.display_name}</span>
              {user.role === 'admin' && <span className={styles.adminTag}>admin</span>}
            </div>
          </div>
          <button
            className={styles.item}
            role="menuitem"
            onClick={() => {
              setOpen(false)
              navigate('/profile')
            }}
          >
            <IconUser size={18} />
            Перейти в профиль
          </button>
          <button
            className={`${styles.item} ${styles.itemDanger}`}
            role="menuitem"
            onClick={() => void logout()}
          >
            Выйти
          </button>
        </div>
      )}
    </div>
  )
}
