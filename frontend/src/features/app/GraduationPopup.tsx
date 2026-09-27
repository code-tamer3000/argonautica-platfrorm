import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePatchMe } from '../../api/profile'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Overlay'
import { useAuth } from '../auth/AuthContext'
import styles from './appshell.module.css'

/**
 * Поп-ап при первом заходе после сдачи выпускной анкеты (`graduated_at`, ARG-157):
 * поздравление + подсказка про дозадачу незавершённых заданий, артефакт экспедиции
 * и открывшийся раздел «Факел». Тот же паттерн, что у WelcomePopup/LimboPopup —
 * «не показывать снова» персистится в `user.settings.graduation_popup_dismissed`
 * (PATCH /auth/me), без чекбокса поп-ап переживает только текущую сессию.
 */
export function GraduationPopup() {
  const { user, refreshMe } = useAuth()
  const patchMe = usePatchMe()
  const navigate = useNavigate()
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [closed, setClosed] = useState(false)

  const dismissed = !!user?.settings.graduation_popup_dismissed
  if (!user || !user.graduated_at || dismissed || closed) return null

  async function handleClose() {
    setClosed(true)
    if (dontShowAgain) {
      await patchMe.mutateAsync({
        settings: { ...user!.settings, graduation_popup_dismissed: true },
      })
      await refreshMe()
    }
  }

  function handleGoToTorch() {
    void handleClose()
    navigate('/torch')
  }

  return (
    <Modal title="Экспедиция пройдена" onClose={handleClose} closeOnBackdrop={false}>
      <p className={styles.welcomeText}>Поздравляем с завершением экспедиции!</p>
      <p className={styles.welcomeText}>
        Если что-то из заданий не успел сдать — можно доздать, они остались доступны
        в разделе «Задачи».
      </p>
      <p className={styles.welcomeText}>
        Тебя ждёт артефакт экспедиции — скачать его можно на главной.
      </p>
      <p className={styles.welcomeText}>
        А ещё тебе открылся клуб «Факел» — переходи в него, чтобы узнать подробности.
      </p>
      <label className={styles.welcomeCheckboxRow}>
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
        />
        Не показывать снова
      </label>
      <Button variant="gold" onClick={handleGoToTorch}>Перейти в «Факел»</Button>
    </Modal>
  )
}
