import { useEffect, useState } from 'react'
import { useAdminCabinEntries, useAdminCabinUsers } from '../../api/cabin'
import { Avatar } from '../../components/Avatar'
import { Spinner } from '../../components/Spinner'
import type { CabinKind } from '../../lib/types'
import { CABIN_SECTIONS } from '../cabin/cabinFields'
import { CabinEntryCard } from '../cabin/CabinEntryCard'
import cabin from '../cabin/cabin.module.css'
import styles from './admin.module.css'

const KINDS: CabinKind[] = ['diary', 'decatastrophize', 'trigger']

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function AdminCabin() {
  const { data: users, isLoading } = useAdminCabinUsers()
  const [userId, setUserId] = useState<number | null>(null)

  // Как только загрузился список — выбираем первого участника.
  useEffect(() => {
    if (userId == null && users && users.length > 0) setUserId(users[0].user_id)
  }, [users, userId])

  if (isLoading) return <div className={styles.page}><Spinner /></div>

  const list = users ?? []

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Каюта</h1>
        <span style={{ fontSize: 'var(--text-ui)', color: 'var(--text-ghost)' }}>
          {list.length} с записями
        </span>
      </div>
      <p style={{ fontSize: 'var(--text-ui)', color: 'var(--text-ghost)', marginTop: -4 }}>
        Записи участников доступны только для чтения. Выберите участника, затем раздел.
      </p>

      {list.length === 0 ? (
        <p className={styles.mediaEmpty}>Пока никто не вносил записи в Каюту.</p>
      ) : (
        <>
          <div className={cabin.userGrid}>
            {list.map((u) => (
              <button
                key={u.user_id}
                type="button"
                className={u.user_id === userId ? cabin.userChipActive : cabin.userChip}
                onClick={() => setUserId(u.user_id)}
              >
                <Avatar name={u.display_name} size={28} />
                <span className={cabin.userChipName}>{u.display_name}</span>
                <span className={cabin.userChipCount}>{u.total}</span>
              </button>
            ))}
          </div>

          {userId != null && <UserEntries userId={userId} />}
        </>
      )}
    </div>
  )
}

function UserEntries({ userId }: { userId: number }) {
  const [kind, setKind] = useState<CabinKind>('diary')
  const section = CABIN_SECTIONS[kind]
  const { data: entries, isLoading } = useAdminCabinEntries(kind, userId)

  return (
    <>
      <div className={cabin.segmented} role="tablist">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? cabin.segActive : cabin.seg}
            onClick={() => setKind(k)}
          >
            {CABIN_SECTIONS[k].title}
          </button>
        ))}
      </div>
      <p className={cabin.subtitle}>{section.subtitle}</p>

      {isLoading && (
        <div className="center" style={{ padding: 'var(--space-6)' }}>
          <Spinner />
        </div>
      )}

      {!isLoading && (entries?.length ?? 0) === 0 && (
        <p className={cabin.empty}>В этом разделе у участника пока нет записей.</p>
      )}

      <div className={cabin.list}>
        {entries?.map((entry) => (
          <CabinEntryCard
            key={entry.id}
            kind={kind}
            entry={entry}
            meta={
              <span>
                {formatDate(entry.created_at)}
                {entry.updated_at !== entry.created_at && ' · изменено ' + formatDate(entry.updated_at)}
              </span>
            }
          />
        ))}
      </div>
    </>
  )
}
