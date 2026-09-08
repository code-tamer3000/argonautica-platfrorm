import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePatchMe } from '../../api/profile'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Overlay'
import { useAuth } from '../auth/AuthContext'
import styles from './appshell.module.css'

/**
 * Междумирье (см. docs/LIMBO.md): грейс-период после понижения с платного
 * тарифа на самый дешёвый. Условие показа — `limbo_deadline_at` не null, само
 * состояние полностью серверное и снимается само (`resolve_limbo`, на каждый
 * запрос) — как только тариф вернулся или срок истёк, поле пропадает и поп-ап
 * перестаёт всплывать сам по себе.
 * «Не показывать снова» — тот же merge-паттерн, что у WelcomePopup
 * (`settings.limbo_popup_dismissed`, PATCH /auth/me) — но, в отличие от него,
 * сервер сам сбрасывает этот флаг на каждый НОВЫЙ заход в Междумирье
 * (`apply_plan_change`), так что дизмисс не переживает следующее понижение.
 */
export function LimboPopup() {
  const { user, refreshMe } = useAuth()
  const patchMe = usePatchMe()
  const navigate = useNavigate()
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [closed, setClosed] = useState(false)

  const dismissed = !!user?.settings.limbo_popup_dismissed
  if (!user || !user.limbo_deadline_at || dismissed || closed) return null

  const deadline = new Date(user.limbo_deadline_at).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })

  async function handleClose() {
    setClosed(true)
    if (dontShowAgain) {
      await patchMe.mutateAsync({
        settings: { ...user!.settings, limbo_popup_dismissed: true },
      })
      await refreshMe()
    }
  }

  function handleGoToTasks() {
    void handleClose()
    navigate('/tasks')
  }

  return (
    <Modal title="Междумирье" onClose={handleClose} closeOnBackdrop={false}>
      <p className={styles.welcomeText}>Ты попал в Междумирье.</p>
      <p className={styles.welcomeText}>
        Чтобы вернуться обратно тебе необходимо включиться и погрести вёслами чуть
        более интенсивно: выполнить висящие Задания и заполнить Дневник.
      </p>
      <p className={styles.welcomeText}>
        Срок — до {deadline}. Не успеешь — останешься в Позиции Наблюдателя.
      </p>
      <p className={styles.welcomeText}>
        <strong>Задание:</strong>
        <br />
        Опиши весь период последних дней
        <br />
        Ты не вёл дневник за прошедший период. Опиши здесь весь этот срок целиком,
        одной записью — как будто это дневник сразу за все пропущенные дни.
      </p>
      <label className={styles.welcomeCheckboxRow}>
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
        />
        Я понял, больше не показывать
      </label>
      <Button variant="gold" onClick={handleGoToTasks}>К задачам</Button>
    </Modal>
  )
}
