import { useReviewQueue } from '../../api/tasks'
import { PageHeader } from '../../components/PageHeader'
import { ReviewQueuePanel } from '../tasks/ReviewQueuePanel'
import styles from './admin.module.css'

// Разметка/группировка очереди — в ReviewQueuePanel (features/tasks/), общая с
// кнопкой-шорткатом «Проверка» на /tasks (TasksList.tsx): один и тот же экран,
// два входа. Здесь — только шапка страницы для захода через меню админки.
export function AdminReview() {
  const { data: items = [] } = useReviewQueue()

  return (
    <div className={styles.page}>
      <PageHeader title="Проверка">
        <span style={{ fontSize: 'var(--text-ui)', color: 'var(--text-ghost)' }}>
          {items.length} на проверке
        </span>
      </PageHeader>
      <ReviewQueuePanel />
    </div>
  )
}
