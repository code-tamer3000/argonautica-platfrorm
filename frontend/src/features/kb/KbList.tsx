import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useKbCategories, useKbItems } from '../../api/kb'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../auth/AuthContext'
import { dayLabel } from '../../lib/format'
import type { KbItemOut } from '../../lib/types'
import styles from './kb.module.css'

// Секция «Без категории» после всех именованных категорий.
const UNCATEGORIZED_KEY = -1

interface Group {
  key: number
  title: string
  items: KbItemOut[]
}

export function KbList() {
  const { data, isLoading } = useKbItems()
  const { data: categories } = useKbCategories()
  const { user } = useAuth()
  const [search, setSearch] = useState('')

  const items = (data ?? []).filter(
    (item) => item.title.toLowerCase().includes(search.toLowerCase()),
  )

  // Группируем по категориям (порядок — из sort_order категорий),
  // «Без категории» — в конце. Пустые категории не показываем.
  const groups = useMemo<Group[]>(() => {
    const byCat = new Map<number, KbItemOut[]>()
    for (const item of items) {
      const key = item.category_id ?? UNCATEGORIZED_KEY
      const bucket = byCat.get(key)
      if (bucket) bucket.push(item)
      else byCat.set(key, [item])
    }
    const result: Group[] = []
    for (const cat of categories ?? []) {
      const catItems = byCat.get(cat.id)
      if (catItems?.length) result.push({ key: cat.id, title: cat.title, items: catItems })
    }
    const uncategorized = byCat.get(UNCATEGORIZED_KEY)
    if (uncategorized?.length) {
      result.push({ key: UNCATEGORIZED_KEY, title: 'Без категории', items: uncategorized })
    }
    return result
  }, [items, categories])

  // Единственная секция «Без категории» и без выбранных категорий — не рисуем заголовок.
  const showHeadings = groups.length > 1 || groups[0]?.key !== UNCATEGORIZED_KEY

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
      {groups.map((group) => (
        <section key={group.key} className={styles.categorySection}>
          {showHeadings && <h2 className={styles.categoryTitle}>{group.title}</h2>}
          <div className={styles.grid}>
            {group.items.map((item) => (
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
        </section>
      ))}
    </div>
  )
}
