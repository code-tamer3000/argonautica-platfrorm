import { useState } from 'react'
import { useJournalDays } from '../../api/messages'
import { useJournalStructure } from '../../api/journal'
import { IconChevronRight } from '../../components/icons'
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

// Панель дневника над композером личного канала. Сам ввод не держит — выбор
// раздела «заряжает» основной composer (см. pendingJournal), там доступны текст,
// вложения, голос и стикеры.
//
// По умолчанию — две кнопки: «Выполнить задание на день» и «Запись».
//  • «Выполнить задание на день» раскрывает бар с чипами разделов и сразу
//    заряжает ПЕРВЫЙ раздел задания — человек видит плашку с описанием и, даже
//    если не переключит раздел, выполнит хотя бы его. Крестик в composer снимает
//    заряд (задание «скидывается»).
//  • «Запись» — свободная личная запись без формата: снимает любой заряд
//    дневника, оставляя обычный composer (сообщение не идёт в прогресс дня).
// Когда бар раскрыт, чипы позволяют переключиться на любой другой раздел.
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
  const active = pendingJournal?.roomId === roomId ? pendingJournal.category : null

  const [open, setOpen] = useState(false)
  // Раскрыт, пока идёт выбор раздела задания. Кнопка «Запись» держит бар
  // свёрнутым (active == null и open == false).
  const expanded = open || active != null

  // Пока структура не загружена / задание без разделов — бар скрыт.
  if (sections.length === 0) return null

  function toggle(category: string) {
    // Повторный тап по «заряженному» разделу снимает выбор.
    setPendingJournal(active === category ? null : { roomId, category })
  }

  // «Выполнить задание на день»: раскрываем чипы и заряжаем первый раздел задания
  // (всегда первый, даже если он уже сдан сегодня — можно дополнить запись).
  function startDayTask() {
    setOpen(true)
    const first = sections[0]
    if (first) setPendingJournal({ roomId, category: first.key })
  }

  // «Запись»: свободная запись без формата — сворачиваем бар и снимаем заряд.
  function startFreeEntry() {
    setOpen(false)
    if (active != null) setPendingJournal(null)
  }

  if (!expanded) {
    return (
      <div className={styles.journalBar}>
        <div className={styles.journalActions}>
          <button type="button" className={styles.journalActionPrimary} onClick={startDayTask}>
            {dayClosed ? '✓ Задания дня выполнены' : 'Выполнить задание на день'}
            {!dayClosed && (
              <span className={styles.journalBarProgress}>{doneCount}/{sections.length}</span>
            )}
          </button>
          <button type="button" className={styles.journalActionSecondary} onClick={startFreeEntry}>
            Запись
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.journalBar}>
      <button
        type="button"
        className={styles.journalBarToggle}
        onClick={startFreeEntry}
        aria-expanded
      >
        <span className={styles.journalBarTitle}>
          {dayClosed ? '✓ Задания дня выполнены' : '📓 Записи дня'}
        </span>
        {!dayClosed && (
          <span className={styles.journalBarProgress}>{doneCount}/{sections.length}</span>
        )}
        <IconChevronRight
          size={16}
          className={`${styles.journalBarChevron} ${styles.journalBarChevronOpen}`}
        />
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
