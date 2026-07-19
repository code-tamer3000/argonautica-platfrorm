import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdvanceStream,
  useForceStreamPhrase,
  usePutStreamText,
  type StreamNodeOut,
  type StreamOut,
} from '../../../api/tasks'
import { useUsersMap } from '../../../api/users'
import { Button } from '../../../components/Button'
import { toast } from '../../../stores/toast'
import { StreamBracket } from './StreamBracket'
import { StreamVoteBox } from './StreamVoteBox'
import { UserTextsModal } from './UserTextsModal'
import styles from './stream.module.css'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка'
}

function localInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

/**
 * Экран задачи-потока: полоса стадии, турнирная сетка, композер личного текста и
 * блок голосования за общую фразу. Админу — продавливание фразы и переход стадии.
 *
 * Данные приезжают уже отфильтрованными по видимости (StreamOut собирается на
 * сервере под смотрящего), поэтому здесь ничего не прячем «на всякий случай».
 */
export function StreamPanel({
  taskId,
  stream,
  isAdmin,
}: {
  taskId: number
  stream: StreamOut
  isAdmin: boolean
}) {
  const [openUserId, setOpenUserId] = useState<number | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)

  const myActiveNode = stream.nodes.find(
    (n) => n.is_mine && n.round === stream.stage_round,
  )
  const selectedNode =
    stream.nodes.find((n) => n.id === selectedNodeId) ?? myActiveNode ?? null

  return (
    <section className={styles.panel}>
      <StageBar taskId={taskId} stream={stream} isAdmin={isAdmin} />

      <StreamBracket
        nodes={stream.nodes}
        depth={stream.depth}
        activeRound={stream.stage_round}
        selectedUserId={openUserId}
        selectedNodeId={selectedNode?.id ?? null}
        onSelectUser={setOpenUserId}
        onSelectNode={setSelectedNodeId}
      />

      {!stream.finished && stream.stage_kind === 'text' && (
        <TextComposer taskId={taskId} stream={stream} />
      )}

      {!stream.finished && stream.stage_kind === 'phrase' && myActiveNode && (
        <StreamVoteBox taskId={taskId} node={myActiveNode} />
      )}

      {selectedNode && (
        <NodeCard node={selectedNode} taskId={taskId} isAdmin={isAdmin} />
      )}

      {openUserId != null && (
        <UserTextsModal
          taskId={taskId}
          userId={openUserId}
          onClose={() => setOpenUserId(null)}
        />
      )}
    </section>
  )
}

/** Где мы в лестнице стадий + дедлайн + админские действия. */
function StageBar({
  taskId,
  stream,
  isAdmin,
}: {
  taskId: number
  stream: StreamOut
  isAdmin: boolean
}) {
  const users = useUsersMap()
  const advance = useAdvanceStream(taskId)
  const [deadline, setDeadline] = useState('')

  const title = stream.finished
    ? 'Поток завершён'
    : stream.stage_kind === 'text'
      ? stream.stage_version === 0
        ? 'Шаг 1 — напишите свой текст'
        : stream.stage_version === stream.depth
          ? 'Финальный текст'
          : `Перепишите свой текст (версия ${stream.stage_version})`
      : `Согласуйте общую фразу — раунд ${stream.stage_round} из ${stream.depth}`

  const pending = stream.pending_user_ids ?? []

  return (
    <header className={styles.stageBar}>
      <div>
        <h3>{title}</h3>
        <p className={styles.stageMeta}>
          Стадия {Math.min(stream.stage + 1, stream.total_stages)} из{' '}
          {stream.total_stages}
          {stream.deadline_at && ` · до ${new Date(stream.deadline_at).toLocaleString()}`}
        </p>
        {isAdmin && !stream.finished && stream.stage_kind === 'text' && (
          <p className={styles.stageMeta}>
            {pending.length === 0
              ? 'Все сдали — можно открывать следующую стадию.'
              : `Ещё не сдали: ${pending
                  .map((id) => users.get(id)?.display_name ?? `#${id}`)
                  .join(', ')}`}
          </p>
        )}
      </div>

      {isAdmin && !stream.finished && (
        <div className={styles.stageActions}>
          <input
            type="datetime-local"
            aria-label="Дедлайн следующей стадии"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
          <Button
            disabled={advance.isPending}
            onClick={() => {
              advance.mutate(localInputToIso(deadline), {
                onSuccess: () => setDeadline(''),
                onError: (err) => toast(errMsg(err)),
              })
            }}
          >
            Следующая стадия
          </Button>
        </div>
      )}
    </header>
  )
}

/** Композер личного текста текущей стадии (правится, пока стадия открыта). */
function TextComposer({ taskId, stream }: { taskId: number; stream: StreamOut }) {
  const [body, setBody] = useState(stream.my_current_text ?? '')
  const save = usePutStreamText(taskId)
  const saved = stream.my_current_text != null

  return (
    <div className={styles.composer}>
      <label htmlFor="stream-text">Ваш текст</label>
      <textarea
        id="stream-text"
        rows={6}
        value={body}
        placeholder="Напишите свой ответ на тему задания…"
        onChange={(e) => setBody(e.target.value)}
      />
      <div className={styles.composerRow}>
        <Button
          disabled={save.isPending || body.trim().length === 0}
          onClick={() =>
            save.mutate(body, {
              onSuccess: () => toast('Текст сохранён'),
              onError: (err) => toast(errMsg(err)),
            })
          }
        >
          {saved ? 'Сохранить изменения' : 'Сдать текст'}
        </Button>
        {saved && <span className={styles.ok}>Сдано — можно править до конца стадии</span>}
      </div>
    </div>
  )
}

/** Карточка выбранного узла: состав, фраза, комната, продавливание админом. */
function NodeCard({
  node,
  taskId,
  isAdmin,
}: {
  node: StreamNodeOut
  taskId: number
  isAdmin: boolean
}) {
  const users = useUsersMap()
  const force = useForceStreamPhrase(taskId)
  const [draft, setDraft] = useState('')

  return (
    <div className={styles.nodeCard}>
      <h4>{node.label}</h4>
      <p className={styles.members}>
        {node.member_ids
          .map((id) => users.get(id)?.display_name ?? `#${id}`)
          .join(', ')}
      </p>

      {node.phrase ? (
        <blockquote className={styles.phrase}>
          {node.phrase}
          {node.approved_by_admin && (
            <span className={styles.badge}>решение админа</span>
          )}
        </blockquote>
      ) : (
        <p className={styles.empty}>Фраза ещё не утверждена или пока не открыта вам.</p>
      )}

      {node.room_id != null && (
        <Link className={styles.roomLink} to={`/chat/${node.room_id}`}>
          Перейти в комнату подгруппы
        </Link>
      )}

      {isAdmin && (
        <div className={styles.forceRow}>
          <input
            value={draft}
            placeholder="Продавить фразу…"
            aria-label="Фраза узла"
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={force.isPending || draft.trim().length === 0}
            onClick={() =>
              force.mutate(
                { nodeId: node.id, text: draft },
                {
                  onSuccess: () => setDraft(''),
                  onError: (err) => toast(errMsg(err)),
                },
              )
            }
          >
            Утвердить
          </Button>
        </div>
      )}
    </div>
  )
}
