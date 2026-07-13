import { useMemo, useState } from 'react'
import { useKbItems } from '../../api/kb'
import { useTasks } from '../../api/tasks'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import type { RefKind } from '../../lib/types'
import styles from './chat.module.css'

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
}

/**
 * Пикер ссылки на материал КБ / задачу. Табы «Материалы»/«Задачи» + поиск по
 * заголовку. Список берётся из тех же хуков, что и разделы КБ/Задач — сервер уже
 * отдаёт только видимое участнику (опубликованные материалы / доступные задачи),
 * так что подставить недоступный id из пикера нельзя.
 */
export function RefPicker({ onPick, onClose }: Props) {
  const [tab, setTab] = useState<RefKind>('kb')
  const [q, setQ] = useState('')

  const kb = useKbItems()
  const tasks = useTasks()

  const needle = q.trim().toLowerCase()

  const kbItems = useMemo(() => {
    const list = kb.data ?? []
    return needle ? list.filter((i) => i.title.toLowerCase().includes(needle)) : list
  }, [kb.data, needle])

  const taskItems = useMemo(() => {
    const list = tasks.data?.items ?? []
    return needle ? list.filter((t) => t.title.toLowerCase().includes(needle)) : list
  }, [tasks.data, needle])

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
          kbItems.map((i) => (
            <button
              key={i.id}
              className={styles.refRow}
              onClick={() => onPick({ kind: 'kb', id: i.id, title: i.title })}
            >
              <span className={styles.refRowIcon}>📄</span>
              <span className={styles.refRowTitle}>{i.title}</span>
            </button>
          ))}
        {tab === 'task' &&
          taskItems.map((t) => (
            <button
              key={t.id}
              className={styles.refRow}
              onClick={() => onPick({ kind: 'task', id: t.id, title: t.title })}
            >
              <span className={styles.refRowIcon}>✅</span>
              <span className={styles.refRowTitle}>{t.title}</span>
            </button>
          ))}
      </div>
    </Modal>
  )
}
