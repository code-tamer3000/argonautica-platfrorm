import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCreateKbItem, useDeleteKbItem, useKbCategories, useKbItems, useUpdateKbItem } from '../../api/kb'
import { BackButton } from '../../components/BackButton'
import ph from '../../components/pageHeader.module.css'
import { Spinner } from '../../components/Spinner'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { cardClass } from '../../components/Card'
import { KebabMenu } from '../../components/KebabMenu'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Modal } from '../../components/Overlay'
import { useAuth } from '../auth/AuthContext'
import { dayLabel } from '../../lib/format'
import type { KbItemOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import { CategoryManager } from './CategoryManager'
import { KbForm, type KbFormValues } from './KbForm'
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
  const isAdmin = user?.role === 'admin'
  const [search, setSearch] = useState('')
  // «Текущая экспедиция» (ARG-104): для admin этот экран не гейтится сервером
  // вообще (полный доступ) — сужаем отображение тем же общим контекстом, что и
  // раньше был у /admin/kb. Выбирается ОДИН раз в /admin/expeditions (AdminExpeditions),
  // здесь только читаем — без своего контрола/баннера, чтобы не плодить UI-шум.
  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const intakeFiltered = isAdmin && currentIntakeId != null

  const allItems = data ?? []
  const items = allItems.filter(
    (item) =>
      item.title.toLowerCase().includes(search.toLowerCase()) &&
      (!intakeFiltered || item.intake_id == null || item.intake_id === currentIntakeId),
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

  const createItem = useCreateKbItem()
  const updateItem = useUpdateKbItem()
  const deleteItem = useDeleteKbItem()
  const [createOpen, setCreateOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [editItem, setEditItem] = useState<KbItemOut | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  function handleCreate(values: KbFormValues) {
    createItem.mutate(
      {
        title: values.title,
        body: values.body || null,
        published: values.published,
        category_id: values.category_id,
        media_asset_ids: values.media_asset_ids,
        intake_id: values.intake_id,
        plan_ids: values.plan_ids,
      },
      {
        onSuccess: () => {
          toast('Создано')
          setCreateOpen(false)
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleEdit(values: KbFormValues) {
    if (!editItem) return
    updateItem.mutate(
      {
        id: editItem.id,
        title: values.title,
        body: values.body || null,
        published: values.published,
        category_id: values.category_id,
        intake_id: values.intake_id,
        plan_ids: values.plan_ids,
      },
      {
        onSuccess: () => {
          toast('Сохранено')
          setEditItem(null)
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function togglePublished(item: KbItemOut) {
    updateItem.mutate(
      { id: item.id, published: !item.published },
      {
        onSuccess: () => toast(item.published ? 'Снято с публикации' : 'Опубликовано'),
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleDelete() {
    if (deleteId == null) return
    deleteItem.mutate(deleteId, {
      onSuccess: () => {
        toast('Удалено')
        setDeleteId(null)
      },
      onError: (err: unknown) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <div className={styles.page}>
      <div className={ph.pageHeader}>
        <div className={`${ph.titleRow} ${styles.titleRow}`}>
          <BackButton />
          <h1 className={styles.pageTitle}>База знаний</h1>
        </div>
        {isAdmin && (
          <div className={ph.pageHeaderActions}>
            <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
              Категории
            </Button>
            <Button onClick={() => setCreateOpen(true)}>Создать</Button>
          </div>
        )}
      </div>
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
              <Link key={item.id} to={`/kb/${item.id}`} className={cardClass({ interactive: true })}>
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>{item.title}</span>
                  {isAdmin && !item.published && <Badge>Черновик</Badge>}
                  {isAdmin && item.published && <Badge tone="accent">Опубликовано</Badge>}
                  {isAdmin && (
                    <KebabMenu
                      ariaLabel="Действия с материалом"
                      items={[
                        { key: 'edit', label: 'Редактировать', onClick: () => setEditItem(item) },
                        {
                          key: 'publish',
                          label: item.published ? 'Снять с публикации' : 'Опубликовать',
                          onClick: () => togglePublished(item),
                        },
                        { key: 'delete', label: 'Удалить', onClick: () => setDeleteId(item.id), danger: true },
                      ]}
                    />
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

      {createOpen && (
        <Modal title="Создать материал" onClose={() => setCreateOpen(false)} closeOnBackdrop={false}>
          <KbForm onSubmit={handleCreate} />
        </Modal>
      )}

      {editItem && (
        <Modal title="Редактировать" onClose={() => setEditItem(null)} closeOnBackdrop={false}>
          <KbForm initial={editItem} onSubmit={handleEdit} item={editItem} />
        </Modal>
      )}

      {categoriesOpen && <CategoryManager onClose={() => setCategoriesOpen(false)} />}

      {deleteId != null && (
        <ConfirmDialog
          title="Удалить материал?"
          text="Материал и комментарии удалятся безвозвратно."
          onConfirm={handleDelete}
          onClose={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
