import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useKbItems } from '../../api/kb'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../auth/AuthContext'
import { dayLabel } from '../../lib/format'
import styles from './kb.module.css'

export function KbList() {
  const { data, isLoading } = useKbItems()
  const { user } = useAuth()
  const [search, setSearch] = useState('')

  const items = (data ?? []).filter(
    (item) => item.title.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>База знаний</h1>
      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          placeholder="Поиск…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {isLoading && <div className="center" style={{ padding: 40 }}><Spinner /></div>}
      {!isLoading && items.length === 0 && (
        <div className="center muted" style={{ padding: 40 }}>
          {search ? 'Ничего не найдено' : 'Материалов пока нет'}
        </div>
      )}
      <div className={styles.grid}>
        {items.map((item) => (
          <Link key={item.id} to={`/kb/${item.id}`} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardTitle}>{item.title}</span>
              {user?.role === 'admin' && !item.published && (
                <span className={styles.badgeDraft}>Черновик</span>
              )}
              {user?.role === 'admin' && item.published && (
                <span className={styles.badgePublished}>Опубликовано</span>
              )}
            </div>
            {item.body && (
              <p className={styles.cardPreview}>
                {item.body.replace(/[#*`_~\[\]()>+-]/g, '').slice(0, 150)}
              </p>
            )}
            <div className={styles.cardMeta}>{dayLabel(item.updated_at)}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
