import { useStreamTexts } from '../../../api/tasks'
import { useUsersMap } from '../../../api/users'
import { Modal } from '../../../components/Overlay'
import { Spinner } from '../../../components/Spinner'
import styles from './stream.module.css'

/**
 * Все версии текста участника, ВИДИМЫЕ смотрящему (клик по участнику в сетке).
 *
 * Пустой список — норма, а не ошибка: чужой черновик открывается только когда
 * стадия закрыта и вы оказались в одном узле (решает сервер, см. docs/TASKS.md).
 */
export function UserTextsModal({
  taskId,
  userId,
  onClose,
}: {
  taskId: number
  userId: number
  onClose: () => void
}) {
  const users = useUsersMap()
  const { data, isLoading } = useStreamTexts(taskId, userId)
  const name = users.get(userId)?.display_name ?? `#${userId}`

  return (
    <Modal title={name} onClose={onClose}>
      {isLoading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <p className={styles.empty}>
          Тексты этого участника вам пока не открыты — они раскрываются по мере
          слияния подгрупп.
        </p>
      ) : (
        <ol className={styles.versions}>
          {data.map((text) => (
            <li key={text.version}>
              <span className={styles.versionLabel}>
                {text.version === 0 ? 'Исходный текст' : `Версия ${text.version}`}
              </span>
              <p>{text.body}</p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}
