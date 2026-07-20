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
import { AutoTextarea } from './AutoTextarea'
import styles from './stream.module.css'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка'
}

/**
 * Голосование за общую фразу узла: любой член подгруппы предлагает вариант, каждый
 * жмёт «за» у одного. Фраза утверждается при ЕДИНОГЛАСИИ — это решает сервер, здесь
 * только показываем, кого ещё ждём.
 *
 * Голос и снятие варианта подтверждаются: утверждённую фразу переиграть нельзя
 * (сервер отдаст 409), а снятие варианта обнуляет отданные за него голоса — обе
 * промашки стоят подгруппе раунда.
 *
 * `readOnly` — режим наблюдения для админа: он в узле не состоит, голосовать ему
 * сервер не даст (assert_node_member), поэтому кнопок не рисуем вовсе; его
 * инструмент — «продавить фразу» в карточке узла.
 *
 * Используется и на экране задачи, и виджетом в комнате подгруппы.
 */
export function StreamVoteBox({
  taskId,
  node,
  readOnly = false,
}: {
  taskId: number
  node: StreamNodeOut
  readOnly?: boolean
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

  const castVote = (optionId: number, text: string) => {
    const confirmed = window.confirm(
      `Отдать голос за «${text}»?\n\n` +
        'Когда за один вариант проголосуют все, фраза утвердится окончательно — ' +
        'переиграть её голосованием уже нельзя.',
    )
    if (!confirmed) return
    vote.mutate(
      { nodeId: node.id, optionId },
      { onError: (err) => toast(errMsg(err)) },
    )
  }

  const dropOption = (optionId: number, votes: number) => {
    const confirmed = window.confirm(
      votes > 0
        ? `Снять свой вариант? За него уже отдано голосов: ${votes} — они пропадут.`
        : 'Снять свой вариант?',
    )
    if (!confirmed) return
    remove.mutate(
      { nodeId: node.id, optionId },
      { onError: (err) => toast(errMsg(err)) },
    )
  }

  return (
    <div className={styles.voteBox}>
      <h4>
        {node.label} — общая фраза
        {readOnly && <span className={styles.badge}>наблюдение</span>}
      </h4>
      <p className={styles.stageMeta}>
        Фраза принимается, когда за один вариант проголосуют все:{' '}
        {node.member_ids.map(name).join(', ')}.
      </p>

      {node.options.length === 0 ? (
        <p className={styles.empty}>
          {readOnly
            ? 'Подгруппа пока не предложила ни одного варианта.'
            : 'Вариантов пока нет — предложите первый.'}
        </p>
      ) : (
        <ul className={styles.options}>
          {node.options.map((option) => {
            const mine = option.id === node.my_vote_option_id
            return (
              <li
                key={option.id}
                className={`${styles.optionCard} ${mine ? styles.chosen : ''}`.trim()}
              >
                <div className={styles.optionHead}>
                  <span className={styles.optionAuthor}>{name(option.author_id)}</span>
                  <span className={styles.optionCount}>
                    {option.voter_ids.length} из {node.member_ids.length}
                  </span>
                </div>

                <p className={styles.optionText}>{option.text}</p>

                <div className={styles.optionRow}>
                  <span className={styles.stageMeta}>
                    {option.voter_ids.length > 0
                      ? `За: ${option.voter_ids.map(name).join(', ')}`
                      : 'Голосов нет'}
                  </span>
                  {!readOnly && (
                    <>
                      <Button
                        variant={mine ? 'gold' : 'outline'}
                        disabled={vote.isPending || mine}
                        onClick={() => castVote(option.id, option.text)}
                      >
                        {mine ? '✓ Ваш голос' : 'Голосовать'}
                      </Button>
                      {option.author_id === user?.id && (
                        <button
                          type="button"
                          className={styles.linkAction}
                          disabled={remove.isPending}
                          onClick={() => dropOption(option.id, option.voter_ids.length)}
                        >
                          Снять
                        </button>
                      )}
                    </>
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

      {!readOnly && (
        <div className={styles.proposeBox}>
          <AutoTextarea
            minRows={2}
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
      )}
    </div>
  )
}
