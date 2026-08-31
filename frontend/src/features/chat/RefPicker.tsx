import { Fragment, useMemo, useState } from 'react'
import { useKbCategories, useKbItems } from '../../api/kb'
import { useTasks } from '../../api/tasks'
import { IconBook, IconTasks } from '../../components/icons'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../auth/AuthContext'
import type { KbItemOut, RefKind } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import styles from './chat.module.css'

// Секция «Без категории» после всех именованных категорий (см. KbList).
const UNCATEGORIZED_KEY = -1

interface KbGroup {
  key: number
  title: string
  items: KbItemOut[]
}

// Выбранная ссылка: title сохраняем локально, чтобы показать чип/кнопку сразу
// (сервер всё равно перерезолвит его для зрителя на чтении).
export interface PickedRef {
  kind: RefKind
  id: number
  title: string
}

interface Props {
  onPick: (ref: PickedRef) => void
  onClose: () => void
  // С какого таба открыть (из меню скрепки: «Материал» → kb, «Задача» → task).
  initialTab?: RefKind
}

/**
 * Пикер ссылки на материал КБ / задачу. Табы «Материалы»/«Задачи» + поиск по
 * заголовку. Список берётся из тех же хуков, что и разделы КБ/Задач — сервер уже
 * отдаёт только видимое участнику (опубликованные материалы / доступные задачи),
 * так что подставить недоступный id из пикера нельзя.
 *
 * Для admin сервер не гейтит эти списки по потоку вообще (полный доступ, как и на
 * /admin/kb, /admin/tasks) — сужаем тем же общим контекстом «текущий поток» (ARG-104),
 * что и KbList/TasksList, иначе в пикере видны материалы и задачи всех прошлых
 * потоков. Материалы дополнительно группируем по категориям КБ (как в KbList).
 */
export function RefPicker({ onPick, onClose, initialTab = 'kb' }: Props) {
  const [tab, setTab] = useState<RefKind>(initialTab)
  const [q, setQ] = useState('')

  const kb = useKbItems()
  const categories = useKbCategories()
  const tasks = useTasks()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const intakeFiltered = isAdmin && currentIntakeId != null

  const needle = q.trim().toLowerCase()

  const kbItems = useMemo(() => {
    const list = kb.data ?? []
    return list.filter(
      (i) =>
        (!needle || i.title.toLowerCase().includes(needle)) &&
        (!intakeFiltered || i.intake_id == null || i.intake_id === currentIntakeId),
    )
  }, [kb.data, needle, intakeFiltered, currentIntakeId])

  // Группируем по категориям (порядок — из sort_order категорий), «Без категории» —
  // в конце, пустые категории не показываем (см. KbList).
  const kbGroups = useMemo<KbGroup[]>(() => {
    const byCat = new Map<number, KbItemOut[]>()
    for (const item of kbItems) {
      const key = item.category_id ?? UNCATEGORIZED_KEY
      const bucket = byCat.get(key)
      if (bucket) bucket.push(item)
      else byCat.set(key, [item])
    }
    const result: KbGroup[] = []
    for (const cat of categories.data ?? []) {
      const catItems = byCat.get(cat.id)
      if (catItems?.length) result.push({ key: cat.id, title: cat.title, items: catItems })
    }
    const uncategorized = byCat.get(UNCATEGORIZED_KEY)
    if (uncategorized?.length) {
      result.push({ key: UNCATEGORIZED_KEY, title: 'Без категории', items: uncategorized })
    }
    return result
  }, [kbItems, categories.data])
  const showKbHeadings = kbGroups.length > 1 || kbGroups[0]?.key !== UNCATEGORIZED_KEY

  const taskItems = useMemo(() => {
    const list = tasks.data?.items ?? []
    return list.filter(
      (t) =>
        (!needle || t.title.toLowerCase().includes(needle)) &&
        (!intakeFiltered || t.intake_id == null || t.intake_id === currentIntakeId),
    )
  }, [tasks.data, needle, intakeFiltered, currentIntakeId])

  const loading = tab === 'kb' ? kb.isLoading : tasks.isLoading
  const empty =
    tab === 'kb' ? kb.data && kbItems.length === 0 : tasks.data && taskItems.length === 0

  return (
    <Modal title="Прикрепить ссылку" onClose={onClose}>
      <div className={styles.refTabs}>
        <button
          className={`${styles.refTab} ${tab === 'kb' ? styles.refTabActive : ''}`}
          onClick={() => setTab('kb')}
        >
          Материалы
        </button>
        <button
          className={`${styles.refTab} ${tab === 'task' ? styles.refTabActive : ''}`}
          onClick={() => setTab('task')}
        >
          Задачи
        </button>
      </div>

      <input
        className={styles.search}
        placeholder={tab === 'kb' ? 'Поиск материала' : 'Поиск задачи'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />

      <div className={styles.refList}>
        {loading && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner />
          </div>
        )}
        {empty && (
          <div className="muted" style={{ padding: 16, fontSize: 14 }}>
            Ничего не найдено
          </div>
        )}
        {tab === 'kb' &&
          kbGroups.map((group) => (
            <Fragment key={group.key}>
              {showKbHeadings && <div className={styles.refCategoryTitle}>{group.title}</div>}
              {group.items.map((i) => (
                <button
                  key={i.id}
                  className={styles.refRow}
                  onClick={() => onPick({ kind: 'kb', id: i.id, title: i.title })}
                >
                  <IconBook size={16} className={styles.refRowIcon} />
                  <span className={styles.refRowTitle}>{i.title}</span>
                </button>
              ))}
            </Fragment>
          ))}
        {tab === 'task' &&
          taskItems.map((t) => (
            <button
              key={t.id}
              className={styles.refRow}
              onClick={() => onPick({ kind: 'task', id: t.id, title: t.title })}
            >
              <IconTasks size={16} className={styles.refRowIcon} />
              <span className={styles.refRowTitle}>{t.title}</span>
            </button>
          ))}
      </div>
    </Modal>
  )
}
