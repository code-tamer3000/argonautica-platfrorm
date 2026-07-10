import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFeedbackList, useResolveFeedback } from '../../api/feedback'
import { useCreateRoom } from '../../api/rooms'
import type { FeedbackKind, FeedbackOut } from '../../lib/types'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import cabin from '../cabin/cabin.module.css'
import styles from './admin.module.css'

const KIND_LABEL: Record<FeedbackKind, string> = {
  improvement: 'Улучшение',
  bug: 'Ошибка',
}

/** Как называется «разобранное» обращение в зависимости от типа. */
const RESOLVED_LABEL: Record<FeedbackKind, string> = {
  improvement: 'Реализовано',
  bug: 'Решено',
}

type Tab = 'active' | 'done'

/** Шапка ответа админа: контекст обращения + пустая строка, дальше пишет админ. */
function buildReplyHeader(item: FeedbackOut): string {
  const lead =
    item.kind === 'improvement'
      ? 'Ответ на ваше предложение'
      : 'Ответ по вашему сообщению об ошибке'
  const snippet = item.body.replace(/\s+/g, ' ').trim().slice(0, 140)
  return `${lead}:\n«${snippet}»\n\n`
}

function formatDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function AdminFeedback() {
  const [tab, setTab] = useState<Tab>('active')
  const { data, isLoading } = useFeedbackList()
  const resolve = useResolveFeedback()
  const createRoom = useCreateRoom()
  const navigate = useNavigate()
  const setPendingOpen = useUiStore((s) => s.setPendingOpen)
  const setPendingDraft = useUiStore((s) => s.setPendingDraft)
  const setDmPeer = useUiStore((s) => s.setDmPeer)

  async function handleReply(item: FeedbackOut) {
    try {
      // ЛС создаётся идемпотентно (дедуп по dm_key) — вернётся существующий, если есть.
      const room = await createRoom.mutateAsync({
        type: 'dm',
        peer_id: item.user_id,
      })
      setDmPeer(room.id, item.user_id)
      setPendingDraft({ roomId: room.id, text: buildReplyHeader(item) })
      setPendingOpen({ roomId: room.id })
      navigate('/')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось открыть чат', 'error')
    }
  }

  function handleToggle(id: number, resolved: boolean) {
    resolve.mutate(
      { id, resolved },
      {
        onSuccess: () => toast(resolved ? 'Разобрано' : 'Возвращено в работу'),
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  if (isLoading) return <div className={styles.page}><Spinner /></div>

  const allItems = data?.items ?? []
  const items = allItems.filter((it) =>
    tab === 'active' ? !it.resolved_at : !!it.resolved_at,
  )

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Обращения</h1>
        {data && data.unresolved_count > 0 && (
          <span className={styles.badgeDraft}>
            Не разобрано: {data.unresolved_count}
          </span>
        )}
      </div>

      <div className={cabin.segmented} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          className={tab === 'active' ? cabin.segActive : cabin.seg}
          onClick={() => setTab('active')}
        >
          Активные
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'done'}
          className={tab === 'done' ? cabin.segActive : cabin.seg}
          onClick={() => setTab('done')}
        >
          Завершённые
        </button>
      </div>

      {items.length === 0 ? (
        <p className={styles.mediaEmpty}>
          {tab === 'active' ? 'Активных обращений нет.' : 'Завершённых обращений нет.'}
        </p>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <div className={styles.listItem} key={item.id}>
              <div className={styles.listItemMain} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-1)' }}>
                <span className={styles.listMeta}>
                  <span className={item.kind === 'bug' ? styles.badgeDraft : styles.badgePublished}>
                    {KIND_LABEL[item.kind]}
                  </span>
                  {' '}
                  {item.user_name ?? `#${item.user_id}`} · {formatDatetime(item.created_at)}
                </span>
                <span className={styles.listDescription} style={{ whiteSpace: 'pre-wrap' }}>
                  {item.body}
                </span>
                {item.resolved_at && (
                  <span className={styles.crumbs}>
                    <span className={styles.badgePublished}>{RESOLVED_LABEL[item.kind]}</span>
                    {' · '}
                    <button
                      type="button"
                      className={styles.crumbLink}
                      onClick={() => handleToggle(item.id, false)}
                    >
                      Вернуть в работу
                    </button>
                  </span>
                )}
              </div>
              <div className={styles.listActions}>
                <Button
                  onClick={() => handleReply(item)}
                  disabled={createRoom.isPending}
                >
                  Ответить
                </Button>
                {!item.resolved_at && (
                  <Button variant="outline" onClick={() => handleToggle(item.id, true)}>
                    Разобрано
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
