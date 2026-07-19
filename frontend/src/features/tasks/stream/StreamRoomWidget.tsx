import { Link } from 'react-router-dom'
import { useStream } from '../../../api/tasks'
import { StreamVoteBox } from './StreamVoteBox'
import styles from './stream.module.css'

/**
 * Голосование за общую фразу прямо в комнате подгруппы потока.
 *
 * Комнату завёл сервер при открытии раунда; `stream_node_id` приходит в RoomOut.
 * Пока раунд этого узла не активен (или уже закрыт), показываем только итог —
 * писать варианты и голосовать бэкенд всё равно не даст.
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

  const active = !stream.finished && stream.stage_round === node.round

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
            <p className={styles.empty}>Раунд этой подгруппы сейчас не идёт.</p>
          )}
        </div>
      )}
      <Link className={styles.roomLink} to={`/tasks/${taskId}`}>
        Открыть сетку потока
      </Link>
    </div>
  )
}
