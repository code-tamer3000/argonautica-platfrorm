import { Link } from 'react-router-dom'
import { useStream } from '../../../api/tasks'
import { StreamVoteBox } from './StreamVoteBox'
import styles from './stream.module.css'

/**
 * Голосование за общую фразу прямо в комнате подгруппы потока.
 *
 * Комнату завёл сервер при открытии раунда; `stream_node_id` приходит в RoomOut.
 * Пока подгруппа не укомплектована (или фраза уже утверждена), показываем только
 * итог — писать варианты и голосовать бэкенд всё равно не даст.
 */
export function StreamRoomWidget({
  taskId,
  nodeId,
}: {
  taskId: number
  nodeId: number
}) {
  const { data: stream } = useStream(taskId)
  const node = stream?.nodes.find((n) => n.id === nodeId)
  if (!stream || !node) return null

  const active = stream.my_active_node_id === node.id

  return (
    <div className={styles.roomWidget}>
      {active ? (
        <StreamVoteBox taskId={taskId} node={node} />
      ) : (
        <div className={styles.voteBox}>
          <h4>{node.label}</h4>
          {node.phrase ? (
            <blockquote className={styles.phrase}>{node.phrase}</blockquote>
          ) : (
            <p className={styles.empty}>
              {node.ready
                ? 'Подгруппа ещё не договорилась о фразе.'
                : 'Ждём, пока все в подгруппе сдадут свой текст.'}
            </p>
          )}
        </div>
      )}
      <Link className={styles.roomLink} to={`/tasks/${taskId}`}>
        Открыть сетку потока
      </Link>
    </div>
  )
}
