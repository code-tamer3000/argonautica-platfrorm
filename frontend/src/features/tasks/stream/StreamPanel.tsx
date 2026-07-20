import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useForceStreamPhrase,
  usePutStreamText,
  type StreamNodeOut,
  type StreamOut,
} from '../../../api/tasks'
import { useUsersMap } from '../../../api/users'
import { Button } from '../../../components/Button'
import { toast } from '../../../stores/toast'
import { AutoTextarea } from './AutoTextarea'
import { StreamBracket } from './StreamBracket'
import { StreamVoteBox } from './StreamVoteBox'
import { UserTextsModal } from './UserTextsModal'
import styles from './stream.module.css'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка'
}

/**
 * Экран задачи-потока: статус участника, турнирная сетка, композер личного текста и
 * блок голосования за общую фразу. Админу — продавливание зависшей фразы.
 *
 * Глобальных стадий нет: что можно делать сейчас, сервер сообщает полями
 * my_version / my_active_node_id / my_waiting_on. Данные приезжают уже
 * отфильтрованными по видимости, поэтому здесь ничего не прячем «на всякий случай».
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

  const myActiveNode = stream.nodes.find((n) => n.id === stream.my_active_node_id)
  const selectedNode =
    stream.nodes.find((n) => n.id === selectedNodeId) ?? myActiveNode ?? null

  return (
    <section className={styles.panel}>
      <StatusBar stream={stream} isAdmin={isAdmin} />

      <StreamBracket
        nodes={stream.nodes}
        depth={stream.depth}
        activeNodeId={stream.my_active_node_id}
        selectedUserId={openUserId}
        selectedNodeId={selectedNode?.id ?? null}
        onSelectUser={setOpenUserId}
        onSelectNode={setSelectedNodeId}
      />

      {/* Композер показываем, пока свою текущую версию человек не отдал. */}
      {!stream.finished && stream.my_current_text == null && (
        <TextComposer taskId={taskId} stream={stream} />
      )}

      {myActiveNode && <StreamVoteBox taskId={taskId} node={myActiveNode} />}

      {stream.my_current_text != null && !myActiveNode && (
        <WaitingNote stream={stream} />
      )}

      {selectedNode && (
        <NodeCard node={selectedNode} taskId={taskId} isAdmin={isAdmin} />
      )}

      {/* Админ в подгруппах не состоит: показываем ход голосования только на просмотр,
          его собственный инструмент — «продавить фразу» в карточке узла выше. */}
      {isAdmin && selectedNode && !selectedNode.is_mine && selectedNode.ready && (
        <StreamVoteBox taskId={taskId} node={selectedNode} readOnly />
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

/** Где лично ты сейчас находишься + дедлайн потока + сводка для админа. */
function StatusBar({ stream, isAdmin }: { stream: StreamOut; isAdmin: boolean }) {
  const users = useUsersMap()
  const name = (id: number) => users.get(id)?.display_name ?? `#${id}`

  const title = stream.finished
    ? 'Поток завершён'
    : stream.my_active_node_id != null
      ? 'Согласуйте общую фразу подгруппы'
      : stream.my_current_text == null
        ? stream.my_version === 0
          ? 'Шаг 1 — напишите свой текст'
          : stream.my_version === stream.depth
            ? 'Финальный текст'
            : `Перепишите свой текст (версия ${stream.my_version})`
        : 'Ждём соседние подгруппы'

  const pending = stream.pending_user_ids ?? []

  return (
    <header className={styles.stageBar}>
      <div>
        <h3>{title}</h3>
        <p className={styles.stageMeta}>
          Версия {stream.my_version} из {stream.depth}
          {stream.deadline_at &&
            ` · срок до ${new Date(stream.deadline_at).toLocaleString()}`}
        </p>
        {isAdmin && !stream.finished && (
          <p className={styles.stageMeta}>
            {pending.length === 0
              ? 'Все сдали то, что могут на своём шаге.'
              : `Ждём текст от: ${pending.map(name).join(', ')}`}
          </p>
        )}
      </div>
    </header>
  )
}

/** «Сделал и жду соседей» — объясняем, кого именно ждём. */
function WaitingNote({ stream }: { stream: StreamOut }) {
  const waiting = stream.my_waiting_on
    .map((id) => stream.nodes.find((n) => n.id === id))
    .filter((n): n is StreamNodeOut => n != null)

  if (stream.finished) return null
  if (waiting.length === 0) {
    return (
      <div className={styles.nodeCard}>
        <p className={styles.empty}>Свою часть вы сдали. Ждём остальных.</p>
      </div>
    )
  }

  return (
    <div className={styles.nodeCard}>
      <h4>Ждём соседей</h4>
      <p className={styles.empty}>
        Свой текст вы сдали. Чтобы двигаться дальше, нужны фразы:{' '}
        {waiting.map((n) => n.label).join(', ')}. Как только они договорятся, вы
        увидите их формулировки и сможете переписать свой текст.
      </p>
    </div>
  )
}

/** Композер личного текста. Версию, которую он пишет, определяет сервер. */
function TextComposer({ taskId, stream }: { taskId: number; stream: StreamOut }) {
  const [body, setBody] = useState(stream.my_current_text ?? '')
  const save = usePutStreamText(taskId)
  const saved = stream.my_current_text != null

  return (
    <div className={styles.composer}>
      <label htmlFor="stream-text">
        {stream.my_version === 0 ? 'Ваш текст' : `Ваш текст, версия ${stream.my_version}`}
      </label>
      <AutoTextarea
        id="stream-text"
        minRows={8}
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
        {saved && (
          <span className={styles.ok}>
            Сдано — правьте, пока подгруппа не утвердила фразу
          </span>
        )}
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

      {/* Действия админа. Голосовать он не может (в узле не состоит) — только
          продавить фразу, если подгруппа зависла на несогласии. */}
      {isAdmin && !node.approved && (
        <div className={styles.adminBox}>
          <h5>Действия администратора</h5>
          <p className={styles.stageMeta}>
            {node.pending_member_ids.length > 0
              ? `Ещё не сдали текст: ${node.pending_member_ids
                  .map((id) => users.get(id)?.display_name ?? `#${id}`)
                  .join(', ')}`
              : 'Все сдали текст — подгруппа согласует фразу.'}
          </p>
          <AutoTextarea
            minRows={2}
            value={draft}
            placeholder="Продавить фразу за подгруппу…"
            aria-label="Фраза узла"
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={force.isPending || draft.trim().length === 0}
            onClick={() => {
              const ok = window.confirm(
                `Утвердить за подгруппу «${node.label}» фразу:\n\n${draft}\n\n` +
                  'Фраза фиксируется окончательно, а комната подгруппы закроется.',
              )
              if (!ok) return
              force.mutate(
                { nodeId: node.id, text: draft },
                {
                  onSuccess: () => setDraft(''),
                  onError: (err) => toast(errMsg(err)),
                },
              )
            }}
          >
            Утвердить за подгруппу
          </Button>
        </div>
      )}
    </div>
  )
}
