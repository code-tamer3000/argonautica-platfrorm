import {
  JOURNAL_CATEGORIES,
  JOURNAL_CATEGORY_META,
  useJournalDays,
  type JournalCategory,
} from '../../api/messages'
import { useUiStore } from '../../stores/ui'
import styles from './chat.module.css'

interface Props {
  roomId: number
}

function currentDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Бар «отписки дня» над композером личного канала. Сам ввод больше не держит —
// выбор категории «заряжает» основной composer (см. pendingJournal), там доступны
// текст, вложения, голос и стикеры. Здесь только выбор категории и прогресс дня.
export function DailyJournalForm({ roomId }: Props) {
  const today = currentDateStr()
  const now = new Date()
  const { data: days } = useJournalDays(roomId, now.getFullYear(), now.getMonth() + 1)
  const todayCats = new Set(days?.[today] ?? [])
  const dayClosed = JOURNAL_CATEGORIES.every((c) => todayCats.has(c))
  const doneCount = JOURNAL_CATEGORIES.filter((c) => todayCats.has(c)).length

  const pendingJournal = useUiStore((s) => s.pendingJournal)
  const setPendingJournal = useUiStore((s) => s.setPendingJournal)
  const active = pendingJournal?.roomId === roomId ? pendingJournal.category : null

  function toggle(category: JournalCategory) {
    // Повторный тап по «заряженной» категории снимает выбор.
    setPendingJournal(active === category ? null : { roomId, category })
  }

  return (
    <div className={styles.journalBar}>
      <span className={styles.journalBarTitle}>
        {dayClosed ? '✓ Задания дня выполнены' : '📓 Отписка дня'}
        {!dayClosed && (
          <span className={styles.journalBarProgress}> {doneCount}/{JOURNAL_CATEGORIES.length}</span>
        )}
      </span>
      <div className={styles.journalChips}>
        {JOURNAL_CATEGORIES.map((key) => {
          const meta = JOURNAL_CATEGORY_META[key]
          const done = todayCats.has(key)
          return (
            <button
              key={key}
              className={`${styles.journalChip} ${active === key ? styles.journalChipActive : ''}`}
              onClick={() => toggle(key)}
              title={done ? `${meta.label} — уже опубликовано сегодня` : meta.label}
            >
              <span>{meta.emoji} {meta.label}</span>
              {done && <span className={styles.journalCheck}>✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
