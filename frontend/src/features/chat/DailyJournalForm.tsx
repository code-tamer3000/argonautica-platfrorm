import { useJournalDays } from '../../api/messages'
import { useJournalStructure } from '../../api/journal'
import { IconChevronLeft, IconDiary, IconEdit } from '../../components/icons'
import { useUiStore } from '../../stores/ui'
import styles from './chat.module.css'

interface Props {
  roomId: number
}

// Журнальный день длится до 03:00 МСК = 00:00 UTC, поэтому «текущий день»
// совпадает с UTC-датой (так же его считает бэкенд). Локальную дату браузера
// брать нельзя: в 00:00–02:59 МСК она уже перещёлкнулась на следующее число,
// а журнальный день — ещё предыдущий.
function currentDateStr() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Панель дневника над композером личного канала. В своём личном дневнике нельзя
// написать «просто так»: композер скрыт, пока здесь не выбран режим (см.
// journalChosen в ChatPane). Три состояния:
//
//  • Выбор (по умолчанию) — две кнопки. Композер скрыт.
//      «Выполнить задание на день» → заряжает ПЕРВЫЙ раздел задания
//        (pendingJournal) и раскрывает чипы; человек видит плашку с описанием и,
//        даже если не переключит раздел, выполнит хотя бы его.
//      «Запись» → свободная запись без формата (journalFreeEntry): композер
//        появляется пустым, сообщение не идёт в прогресс дня.
//  • Задание — заряжен раздел: показываем чипы для переключения. Крестик в
//    композере снимает заряд и возвращает к выбору.
//  • Запись — свободный режим: узкий бар с кнопкой «← Назад» к выбору.
export function DailyJournalForm({ roomId }: Props) {
  const today = currentDateStr()
  const now = new Date()
  const { data: days } = useJournalDays(roomId, now.getUTCFullYear(), now.getUTCMonth() + 1)
  const { data: structure } = useJournalStructure()
  const sections = structure?.sections ?? []
  const todayCats = new Set(days?.[today] ?? [])
  const dayClosed = sections.length > 0 && sections.every((s) => todayCats.has(s.key))
  const doneCount = sections.filter((s) => todayCats.has(s.key)).length

  const pendingJournal = useUiStore((s) => s.pendingJournal)
  const setPendingJournal = useUiStore((s) => s.setPendingJournal)
  const journalFreeEntry = useUiStore((s) => s.journalFreeEntry)
  const setJournalFreeEntry = useUiStore((s) => s.setJournalFreeEntry)
  const active = pendingJournal?.roomId === roomId ? pendingJournal.category : null
  const freeEntry = journalFreeEntry === roomId

  // Пока структура не загружена / задание без разделов — бар скрыт.
  if (sections.length === 0) return null

  function toggle(category: string) {
    // Переключение раздела; повторный тап по активному возвращает к выбору.
    if (active === category) {
      setPendingJournal(null)
    } else {
      setPendingJournal({ roomId, category })
    }
  }

  // «Выполнить задание на день»: заряжаем первый раздел задания (всегда первый,
  // даже если он уже сдан сегодня — можно дополнить запись).
  function startDayTask() {
    setJournalFreeEntry(null)
    const first = sections[0]
    if (first) setPendingJournal({ roomId, category: first.key })
  }

  // «Запись»: свободная запись без формата.
  function startFreeEntry() {
    setPendingJournal(null)
    setJournalFreeEntry(roomId)
  }

  // Возврат к выбору режима из любого состояния.
  function backToChoice() {
    if (active != null) setPendingJournal(null)
    if (freeEntry) setJournalFreeEntry(null)
  }

  // Режим «свободная запись»: узкий бар с возвратом к выбору.
  if (freeEntry) {
    return (
      <div className={styles.journalBar}>
        <button type="button" className={styles.journalBarToggle} onClick={backToChoice}>
          <IconChevronLeft size={16} className={styles.journalBarChevronBack} />
          <span className={styles.journalBarTitle}>Свободная запись</span>
        </button>
      </div>
    )
  }

  // Режим «задание»: чипы разделов + возврат к выбору.
  if (active != null) {
    return (
      <div className={styles.journalBar}>
        <button
          type="button"
          className={styles.journalBarToggle}
          onClick={backToChoice}
          aria-expanded
        >
          <IconChevronLeft size={16} className={styles.journalBarChevronBack} />
          <IconDiary size={15} className={styles.journalBarTitleIcon} />
          <span className={styles.journalBarTitle}>
            {dayClosed ? 'Задания дня выполнены' : 'Задания дня'}
          </span>
          {!dayClosed && (
            <span className={styles.journalBarProgress}>{doneCount}/{sections.length}</span>
          )}
        </button>
        <div className={styles.journalChips}>
          {sections.map((section) => {
            const done = todayCats.has(section.key)
            return (
              <button
                key={section.key}
                className={`${styles.journalChip} ${active === section.key ? styles.journalChipActive : ''}`}
                onClick={() => toggle(section.key)}
                title={done ? `${section.label} — уже опубликовано сегодня` : section.label}
              >
                <span>{section.emoji} {section.label}</span>
                {done && <span className={styles.journalCheck}>✓</span>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Выбор режима: две крупные кнопки. Композер в этом состоянии скрыт (ChatPane).
  return (
    <div className={`${styles.journalBar} ${styles.journalChoiceBar}`}>
      <div className={styles.journalChoice}>
        <button type="button" className={styles.journalChoiceBtn} onClick={startDayTask}>
          <IconDiary size={22} className={styles.journalChoiceIcon} />
          <span className={styles.journalChoiceText}>
            <span className={styles.journalChoiceTitle}>
              {dayClosed ? 'Задания дня выполнены' : 'Выполнить задания на день'}
            </span>
            <span className={styles.journalChoiceSub}>
              {dayClosed ? 'Можно дополнить запись' : `Прогресс дня — ${doneCount}/${sections.length}`}
            </span>
          </span>
        </button>
        <button
          type="button"
          className={`${styles.journalChoiceBtn} ${styles.journalChoiceBtnGhost}`}
          onClick={startFreeEntry}
        >
          <IconEdit size={22} className={styles.journalChoiceIcon} />
          <span className={styles.journalChoiceText}>
            <span className={styles.journalChoiceTitle}>Свободная запись</span>
            <span className={styles.journalChoiceSub}>Личная заметка без формата</span>
          </span>
        </button>
      </div>
    </div>
  )
}
