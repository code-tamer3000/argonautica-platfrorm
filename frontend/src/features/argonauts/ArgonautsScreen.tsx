import { Link } from 'react-router-dom'
import { useArgonauts } from '../../api/argonauts'
import { Avatar } from '../../components/Avatar'
import { cardClass } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import { plural } from '../../lib/format'
import { contactPlanKey, groupPreOrdered } from '../../lib/planGroups'
import type { ArgonautOut } from '../../lib/types'
import styles from './argonauts.module.css'

function Tile({ a }: { a: ArgonautOut }) {
  return (
    <Link
      to={`/argonauts/${a.id}`}
      className={cardClass({ interactive: true, className: styles.tile })}
    >
      <Avatar name={a.display_name} url={a.avatar_url} size={64} />
      <div className={styles.tileName}>{a.display_name}</div>
      {a.role !== 'admin' && a.tasks_done > 0 && (
        <div className={styles.tileMeta}>
          Выполнено {a.tasks_done} {plural(a.tasks_done, ['задача', 'задачи', 'задач'])}
        </div>
      )}
    </Link>
  )
}

export function ArgonautsScreen() {
  const { data, isLoading } = useArgonauts()
  // Сервер уже отдал участников по рангу тарифа, админов — хвостом (ARG-110
  // соглашение, см. api/argonauts.py `_roster`) — просто режем на секции по
  // соседним элементам, как контакт-лист «начать чат».
  const groups = groupPreOrdered(data ?? [], contactPlanKey)

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
      {!isLoading &&
        groups.map((group) => (
          <div key={group.key} className={styles.section}>
            {groups.length > 1 && <div className={styles.sectionTitle}>{group.label}</div>}
            <div className={styles.grid}>
              {group.items.map((a) => (
                <Tile key={a.id} a={a} />
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}
