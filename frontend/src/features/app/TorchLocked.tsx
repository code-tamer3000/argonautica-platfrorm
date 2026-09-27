import { useNavigate } from 'react-router-dom'
import { useApplyToTorch, useTorchStub } from '../../api/torch'
import { Button } from '../../components/Button'
import { IconFlame } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { toast } from '../../stores/toast'
import styles from './appshell.module.css'

/**
 * Заглушка клуба «Факел» (ARG-54) — виден выпустившемуся, у которого админ ещё
 * не включил `torch_unlocked`. Текст один общий на всех закрытых, правит его
 * админ в /admin/torch (`GET /api/torch/stub`), а не жёстко зашит на клиенте —
 * в отличие от ObserverBlocked/CohortPending.
 *
 * Кнопка «Подать заявку» (ARG-158) видна только если в /admin/torch назначен
 * администратор клуба (`apply_admin_id`) — открывает/переоткрывает DM с ним
 * через `/chats/{roomId}`, а не `/torch/{roomId}`: сам раздел «Факел» ещё
 * закрыт тумблером, а этот чат — исключение, не тычок в тот же гейт.
 */
export function TorchLocked() {
  const { data, isLoading } = useTorchStub(true)
  const apply = useApplyToTorch()
  const navigate = useNavigate()

  function handleApply() {
    apply.mutate(void 0, {
      onSuccess: (res) => navigate(`/chats/${res.room_id}`),
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <div className={`center grow col ${styles.observerBlocked}`}>
      <span className={styles.observerBlockedIcon} aria-hidden>
        <IconFlame />
      </span>
      <h2 className={styles.observerBlockedTitle}>Факел</h2>
      {isLoading ? (
        <Spinner />
      ) : (
        <>
          <p className={styles.observerBlockedText}>{data?.stub_text}</p>
          {data?.apply_admin_id != null && (
            <Button variant="gold" disabled={apply.isPending} onClick={handleApply}>
              Подать заявку
            </Button>
          )}
        </>
      )}
    </div>
  )
}
