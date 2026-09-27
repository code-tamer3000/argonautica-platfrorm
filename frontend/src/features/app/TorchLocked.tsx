import { useTorchStub } from '../../api/torch'
import { IconFlame } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import styles from './appshell.module.css'

/**
 * Заглушка клуба «Факел» (ARG-54) — виден выпустившемуся, у которого админ ещё
 * не включил `torch_unlocked`. Текст один общий на всех закрытых, правит его
 * админ в /admin/torch (`GET /api/torch/stub`), а не жёстко зашит на клиенте —
 * в отличие от ObserverBlocked/CohortPending.
 */
export function TorchLocked() {
  const { data, isLoading } = useTorchStub(true)
  return (
    <div className={`center grow col ${styles.observerBlocked}`}>
      <span className={styles.observerBlockedIcon} aria-hidden>
        <IconFlame />
      </span>
      <h2 className={styles.observerBlockedTitle}>Факел</h2>
      {isLoading ? (
        <Spinner />
      ) : (
        <p className={styles.observerBlockedText}>{data?.stub_text}</p>
      )}
    </div>
  )
}
