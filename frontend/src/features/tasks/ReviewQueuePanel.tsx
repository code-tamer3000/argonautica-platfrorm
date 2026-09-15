import { useState } from 'react'
import { usePlans } from '../../api/plans'
import { useReviewQueue, useTaskSubmissions, type ReviewQueueItemOut } from '../../api/tasks'
import { Avatar } from '../../components/Avatar'
import { Spinner } from '../../components/Spinner'
import { TrackCard } from './TaskDetail'
import styles from './tasks.module.css'

const TASK_TYPE_LABEL: Record<string, string> = {
  common: 'Общая',
  individual: 'Индивидуальная',
  pair: 'Парная',
  stream: 'Поток',
}

const NO_PLAN_KEY = 'none'

function dateTime(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Строка очереди раскрывается в тот же TrackCard, что и на карточке задачи —
// подгружает треки задачи лениво (только при раскрытии), фильтрует до своего
// assignment_id, чтобы не тащить в разметку остальные сдачи той же задачи.
function QueueRow({ item }: { item: ReviewQueueItemOut }) {
  const [expanded, setExpanded] = useState(false)
  const { data: tracks, isLoading } = useTaskSubmissions(expanded ? item.task_id : 0)
  const track = tracks?.find((t) => t.assignment_id === item.assignment_id)

  return (
    <div className={styles.queueItem}>
      <button
        type="button"
        className={styles.queueItemMain}
        onClick={() => setExpanded((v) => !v)}
      >
        <Avatar name={item.display_name} url={item.avatar_url} size={28} />
        <span className={styles.queueItemTitle}>
          {item.display_name} — {item.task_title}
          {item.late && ' · сдано позже'}
        </span>
        <span className={styles.queueItemMeta}>
          {TASK_TYPE_LABEL[item.task_type] ?? item.task_type} · {dateTime(item.submitted_at)}
        </span>
      </button>
      {expanded && (
        <div className={styles.queueItemBody}>
          {isLoading || !track ? (
            <div className="center" style={{ padding: 'var(--space-3)' }}><Spinner size={16} /></div>
          ) : (
            <div className={styles.section} style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
              <TrackCard track={track} taskId={item.task_id} isAdmin />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Раздел «Проверка» (ARG-134): все сдачи в статусе «на проверке» по всем
 * задачам сразу, сгруппированные по тарифу сдавшего — раньше был единым
 * потоком, из-за которого сдачи разных тарифов было не найти на глаз.
 * Порядок групп — по цене тарифа (как в `usePlans()`), «Без тарифа» — последней;
 * группа без сдач не рендерится вовсе. */
export function ReviewQueuePanel() {
  const { data: items = [], isLoading: queueLoading } = useReviewQueue()
  const { data: plans = [], isLoading: plansLoading } = usePlans()

  if (queueLoading || plansLoading) return <div className="center" style={{ padding: 40 }}><Spinner /></div>

  if (items.length === 0) {
    return <p className={styles.queueEmpty}>Нечего проверять — все сдачи рассмотрены.</p>
  }

  const byPlan = new Map<number | typeof NO_PLAN_KEY, ReviewQueueItemOut[]>()
  const knownPlanIds = new Set(plans.map((p) => p.id))
  for (const item of items) {
    const key = item.plan_id != null && knownPlanIds.has(item.plan_id) ? item.plan_id : NO_PLAN_KEY
    const bucket = byPlan.get(key)
    if (bucket) bucket.push(item)
    else byPlan.set(key, [item])
  }

  const groups: { label: string; items: ReviewQueueItemOut[] }[] = []
  for (const plan of plans) {
    const bucket = byPlan.get(plan.id)
    if (bucket?.length) groups.push({ label: plan.name, items: bucket })
  }
  const noPlan = byPlan.get(NO_PLAN_KEY)
  if (noPlan?.length) groups.push({ label: 'Без тарифа', items: noPlan })

  return (
    <div className={styles.queueGroups}>
      {groups.map((g) => (
        <section key={g.label} className={styles.queueGroup}>
          <h3 className={styles.queueGroupTitle}>
            {g.label} <span className={styles.queueGroupCount}>{g.items.length}</span>
          </h3>
          <div className={styles.queueList}>
            {g.items.map((item) => (
              <QueueRow key={item.assignment_id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
