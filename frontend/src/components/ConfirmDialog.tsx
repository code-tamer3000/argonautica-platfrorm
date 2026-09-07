import { Modal } from './Overlay'
import { Button } from './Button'
import styles from './confirmDialog.module.css'

// Двухшаговое подтверждение опасного действия (удаление) взамен window.confirm —
// та же модалка, что уже была ad-hoc для «Отменить загрузку?» в AdminKb.
export function ConfirmDialog({
  title,
  text,
  confirmLabel = 'Удалить',
  onConfirm,
  onClose,
}: {
  title: string
  text: string
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className={styles.text}>{text}</p>
      <div className={styles.actions}>
        <Button variant="outline" type="button" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="danger" type="button" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
