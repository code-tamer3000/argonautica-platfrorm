import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Overlay'
import { useAuth } from '../auth/AuthContext'

/**
 * Междумирье (см. docs/LIMBO.md): грейс-период после понижения с платного
 * тарифа на самый дешёвый. Поп-ап полностью серверный — сам факт наличия
 * `limbo_deadline_at` и есть условие показа, отдельного «не показывать снова»
 * нет (в отличие от WelcomePopup): состояние снимается бэком само
 * (`resolve_limbo`, вызывается на каждый запрос) — как только тариф вернулся
 * или срок истёк, `limbo_deadline_at` пропадает и поп-ап перестаёт всплывать.
 * `closed` — только чтобы не мешать в текущей сессии, при следующей
 * загрузке/логине покажется опять, пока состояние живо.
 */
export function LimboPopup() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [closed, setClosed] = useState(false)

  if (!user || !user.limbo_deadline_at || closed) return null

  const deadline = new Date(user.limbo_deadline_at).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })

  function handleGoToTasks() {
    setClosed(true)
    navigate('/tasks')
  }

  return (
    <Modal title="Вы попали в Междумирье!" onClose={() => setClosed(true)} closeOnBackdrop={false}>
      <p>
        Вам надо включиться — выполнить задания и отработать пропуск дневника
        выполнением допзадания — и тогда вы вернётесь обратно.
      </p>
      <p>Срок — до {deadline}. Не успеете — тариф останется как есть.</p>
      <Button variant="gold" onClick={handleGoToTasks}>К задачам</Button>
    </Modal>
  )
}
