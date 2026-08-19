import { useNavigate } from 'react-router-dom'
import { useCanGoBack } from '../lib/useCanGoBack'
import { IconBack } from './icons'
import styles from './pageHeader.module.css'

// «Назад» — это шаг по истории браузера, а не подъём к родительскому разделу:
// пришли в Ключи из Дневника — вернёмся в Дневник, а не в корень Ключей.
// На первом экране сессии возвращаться некуда, и кнопки там просто нет.
export function BackButton({ className }: { className?: string }) {
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()

  if (!canGoBack) return null

  return (
    <button
      type="button"
      className={className ? `${styles.backBtn} ${className}` : styles.backBtn}
      onClick={() => navigate(-1)}
      title="Назад"
      aria-label="Назад"
    >
      <IconBack size={20} />
    </button>
  )
}
