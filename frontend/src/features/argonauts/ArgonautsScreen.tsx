import { Link } from 'react-router-dom'
import { useArgonauts } from '../../api/argonauts'
import { Avatar } from '../../components/Avatar'
import { cardClass } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../auth/AuthContext'
import { plural } from '../../lib/format'
import { groupPreOrdered } from '../../lib/planGroups'
import type { ArgonautOut } from '../../lib/types'
import styles from './argonauts.module.css'

function Tile({ a, isOwn }: { a: ArgonautOut; isOwn: boolean }) {
  return (
    <Link
      to={`/argonauts/${a.id}`}
      className={cardClass({ interactive: true, accent: isOwn, className: styles.tile })}
    >
      <Avatar name={a.display_name} url={a.avatar_url} size={64} />
      <div className={styles.tileName}>{a.display_name}</div>
      {a.role !== 'admin' && !a.is_observer && a.tasks_done > 0 && (
        <div className={styles.tileMeta}>
          Выполнено {a.tasks_done} {plural(a.tasks_done, ['задача', 'задачи', 'задач'])}
        </div>
      )}
    </Link>
  )
}

/** Заголовки секций ростера во множественном числе — тарифы «Спецотряд»/«Око»
 * читаются как группа и так, их названия из БД не трогаем. */
const SECTION_LABELS: Record<string, string> = {
  Игрок: 'Игроки',
  Наблюдатель: 'Наблюдатели',
}

/** Ключ секции ростера: админы (сервер ставит их первыми), затем тарифы, затем
 * наблюдатели одной секцией — у них может быть любой тариф либо тариф
 * «Наблюдатель», группирует их именно флаг, а не plan_id. */
function argonautSectionKey(a: ArgonautOut): { id: number | null; name: string | null } {
  if (a.role === 'admin') return { id: -1, name: 'Админы' }
  if (a.is_observer) return { id: -2, name: 'Наблюдатели' }
  return { id: a.plan_id, name: a.plan_name && (SECTION_LABELS[a.plan_name] ?? a.plan_name) }
}

export function ArgonautsScreen() {
  const { data, isLoading } = useArgonauts()
  const { user: me } = useAuth()
  // Сервер уже отдал порядок: админы, участники по рангу тарифа, наблюдатели
  // хвостом (см. api/argonauts.py `_roster`) — просто режем на секции по
  // соседним элементам, как контакт-лист «начать чат».
  const groups = groupPreOrdered(data ?? [], argonautSectionKey)

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
                <Tile key={a.id} a={a} isOwn={a.id === me?.id} />
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}
