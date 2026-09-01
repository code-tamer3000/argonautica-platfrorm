import { Link } from 'react-router-dom'
import { useArgonauts } from '../../api/argonauts'
import { Avatar } from '../../components/Avatar'
import { cardClass } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import { plural } from '../../lib/format'
import styles from './argonauts.module.css'

export function ArgonautsScreen() {
  const { data, isLoading } = useArgonauts()

  return (
    <div className={styles.wrap}>
      <PageHeader title="Аргонавты" />
      {isLoading && (
        <div className="center grow">
          <Spinner />
        </div>
      )}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <EmptyState size="block">Пока в потоке больше никого нет.</EmptyState>
      )}
      {!isLoading && !!data?.length && (
        <div className={styles.grid}>
          {data.map((a) => (
            <Link key={a.id} to={`/argonauts/${a.id}`} className={cardClass({ interactive: true, className: styles.tile })}>
              <Avatar name={a.display_name} url={a.avatar_url} size={64} />
              <div className={styles.tileName}>{a.display_name}</div>
              <div className={styles.tileMeta}>
                Выполнено {a.tasks_done} {plural(a.tasks_done, ['задача', 'задачи', 'задач'])}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
