import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStream } from '../../../api/tasks'
import { useIsMobile } from '../../../hooks/useIsMobile'
import { StreamVoteBox } from './StreamVoteBox'
import styles from './stream.module.css'

/**
 * Голосование за общую фразу прямо в комнате подгруппы потока.
 *
 * Комнату завёл сервер при открытии раунда; `stream_node_id` приходит в RoomOut.
 * Пока подгруппа не укомплектована (или фраза уже утверждена), показываем только
 * итог — писать варианты и голосовать бэкенд всё равно не даст.
 *
 * Виджет висит НАД лентой, поэтому целиком сворачивается: на мобиле развёрнутый
 * блок с вариантами перекрывал почти весь чат. По умолчанию на телефоне свёрнут,
 * на десктопе развёрнут — там места хватает.
 */
export function StreamRoomWidget({
  taskId,
  nodeId,
}: {
  taskId: number
  nodeId: number
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(!isMobile)
  const { data: stream } = useStream(taskId)
  const node = stream?.nodes.find((n) => n.id === nodeId)
  if (!stream || !node) return null

  const active = stream.my_active_node_id === node.id
  const status = node.approved
    ? 'фраза утверждена'
    : active
      ? 'идёт голосование'
      : node.ready
        ? 'фраза не согласована'
        : 'ждём тексты подгруппы'

  return (
    <div className={styles.roomWidget}>
      <button
        type="button"
        className={styles.widgetToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {node.label} — {status}
        </span>
        <span className={styles.widgetAction}>
          {open ? 'Свернуть' : 'Развернуть'}
        </span>
      </button>

      {open && (
        <div className={styles.widgetBody}>
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
      )}
    </div>
  )
}
