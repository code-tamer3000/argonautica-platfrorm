import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePatchMe } from '../../api/profile'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Overlay'
import { renderMessageText } from '../../lib/messageText'
import { useAuth } from '../auth/AuthContext'
import styles from './appshell.module.css'

/**
 * Приветственный поп-ап при первом входе (ARG-106): текст — `intake_welcome_message`
 * с бэка (as-is из ARG-105, NEWS_BODY набора), тот же, что уходит новостным постом —
 * поэтому рендерим через тот же renderMessageText (см. MessageItem), иначе
 * [текст](/путь) из NEWS_BODY показался бы буквально, а не ссылкой.
 * «Не показывать снова» персистится в `user.settings.welcome_popup_dismissed`
 * (см. PATCH /auth/me, тот же merge-паттерн, что у NotificationsSection).
 */
export function WelcomePopup() {
  const { user, refreshMe } = useAuth()
  const patchMe = usePatchMe()
  const navigate = useNavigate()
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [closed, setClosed] = useState(false)

  const text = user?.intake_welcome_message
  const dismissed = !!user?.settings.welcome_popup_dismissed
  if (!user || !text || dismissed || closed) return null

  async function handleClose() {
    setClosed(true)
    if (dontShowAgain) {
      await patchMe.mutateAsync({
        settings: { ...user!.settings, welcome_popup_dismissed: true },
      })
      await refreshMe()
    }
  }

  // Ссылка внутри текста ведёт на другой экран — попап закрываем тем же путём, что и
  // «Понятно», иначе он повиснет поверх новой страницы (WelcomePopup живёт в AppShell,
  // не размонтируется при смене маршрута).
  function handleLinkClick(path: string) {
    navigate(path)
    void handleClose()
  }

  return (
    <Modal title="Добро пожаловать" onClose={handleClose} closeOnBackdrop={false}>
      <p className={styles.welcomeText}>{renderMessageText(text, undefined, handleLinkClick)}</p>
      <label className={styles.welcomeCheckboxRow}>
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
        />
        Не показывать снова
      </label>
      <Button variant="gold" onClick={handleClose}>Понятно</Button>
    </Modal>
  )
}
