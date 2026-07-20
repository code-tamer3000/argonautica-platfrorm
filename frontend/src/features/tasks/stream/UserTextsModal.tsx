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
          {data.map((text, i) => (
            <li key={text.version}>
              {/* Свёрнутые карточки: версий бывает до depth+1, сплошной простынёй их
                  не сравнить. Раскрыта последняя — она и интересна. */}
              <details className={styles.versionCard} open={i === data.length - 1}>
                <summary>
                  <span className={styles.versionLabel}>
                    {text.version === 0 ? 'Исходный текст' : `Версия ${text.version}`}
                  </span>
                  <span className={styles.versionDate}>
                    {new Date(text.updated_at).toLocaleDateString()}
                  </span>
                </summary>
                <p>{text.body}</p>
              </details>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}
