import { useState } from 'react'
import {
  useCreateStreamOption,
  useDeleteStreamOption,
  useVoteStreamOption,
  type StreamNodeOut,
} from '../../../api/tasks'
import { useUsersMap } from '../../../api/users'
import { useAuth } from '../../auth/AuthContext'
import { Button } from '../../../components/Button'
import { toast } from '../../../stores/toast'
import styles from './stream.module.css'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка'
}

/**
 * Голосование за общую фразу узла: любой член подгруппы предлагает вариант, каждый
 * жмёт «за» у одного. Фраза утверждается при ЕДИНОГЛАСИИ — это решает сервер, здесь
 * только показываем, кого ещё ждём.
 *
 * Используется и на экране задачи, и виджетом в комнате подгруппы.
 */
export function StreamVoteBox({
  taskId,
  node,
}: {
  taskId: number
  node: StreamNodeOut
}) {
  const { user } = useAuth()
  const users = useUsersMap()
  const [draft, setDraft] = useState('')
  const propose = useCreateStreamOption(taskId)
  const vote = useVoteStreamOption(taskId)
  const remove = useDeleteStreamOption(taskId)

  const voted = new Set(node.options.flatMap((o) => o.voter_ids))
  const waiting = node.member_ids.filter((id) => !voted.has(id))
  const name = (id: number) => users.get(id)?.display_name ?? `#${id}`

  if (node.approved) {
    return (
      <div className={styles.voteBox}>
        <h4>{node.label} — фраза утверждена</h4>
        <blockquote className={styles.phrase}>{node.phrase}</blockquote>
      </div>
    )
  }

  return (
    <div className={styles.voteBox}>
      <h4>{node.label} — общая фраза</h4>
      <p className={styles.stageMeta}>
        Фраза принимается, когда за один вариант проголосуют все:{' '}
        {node.member_ids.map(name).join(', ')}.
      </p>

      {node.options.length === 0 ? (
        <p className={styles.empty}>Вариантов пока нет — предложите первый.</p>
      ) : (
        <ul className={styles.options}>
          {node.options.map((option) => {
            const mine = option.id === node.my_vote_option_id
            return (
              <li key={option.id} className={mine ? styles.chosen : undefined}>
                <p>{option.text}</p>
                <div className={styles.optionRow}>
                  <span className={styles.stageMeta}>
                    {option.voter_ids.length > 0
                      ? `За: ${option.voter_ids.map(name).join(', ')}`
                      : 'Голосов нет'}
                  </span>
                  <Button
                    variant={mine ? 'gold' : 'outline'}
                    disabled={vote.isPending}
                    onClick={() =>
                      vote.mutate(
                        { nodeId: node.id, optionId: option.id },
                        { onError: (err) => toast(errMsg(err)) },
                      )
                    }
                  >
                    {mine ? 'Ваш голос' : 'За'}
                  </Button>
                  {option.author_id === user?.id && (
                    <Button
                      variant="outline"
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(
                          { nodeId: node.id, optionId: option.id },
                          { onError: (err) => toast(errMsg(err)) },
                        )
                      }
                    >
                      Снять
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {waiting.length > 0 && node.options.length > 0 && (
        <p className={styles.stageMeta}>Ждём голос: {waiting.map(name).join(', ')}</p>
      )}

      <div className={styles.composerRow}>
        <input
          value={draft}
          placeholder="Предложить свою формулировку…"
          aria-label="Вариант общей фразы"
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          disabled={propose.isPending || draft.trim().length === 0}
          onClick={() =>
            propose.mutate(
              { nodeId: node.id, text: draft },
              {
                onSuccess: () => setDraft(''),
                onError: (err) => toast(errMsg(err)),
              },
            )
          }
        >
          Предложить
        </Button>
      </div>
    </div>
  )
}
