import { useEffect, useState } from 'react'
import {
  JOURNAL_CATEGORIES,
  useJournalDays,
  useSendMessage,
  type JournalCategory,
} from '../../api/messages'
import styles from './chat.module.css'

interface Props {
  roomId: number
  userId: number
}

interface CatConfig {
  key: JournalCategory
  tab: string          // короткая подпись на кнопке-табе
  heading: string      // markdown-заголовок публикуемой записи
  label: string        // подпись поля ввода
  placeholder: string
  multiline: boolean
}

const CATS: CatConfig[] = [
  {
    key: 'focus',
    tab: '🎯 Фокус',
    heading: '## 🎯 Фокус на день',
    label: 'Фокус / концентрация дня',
    placeholder: 'Концентрация намерения на день',
    multiline: true,
  },
  {
    key: 'notes',
    tab: '📝 Заметки',
    heading: '## 📝 Заметки',
    label: 'Заметки',
    placeholder: 'Процесс исследования',
    multiline: true,
  },
  {
    key: 'film',
    tab: '🎬 Фильм дня',
    heading: '',  // название фильма само по себе — заголовок (см. publish)
    label: 'Как бы ты назвал фильм про сегодняшний день?',
    placeholder: 'фильм дня',
    multiline: false,
  },
]

function currentDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const draftKey = (userId: number, date: string, cat: JournalCategory) =>
  `journal-draft-${userId}-${date}-${cat}`

export function DailyJournalForm({ roomId, userId }: Props) {
  const today = currentDateStr()
  const now = new Date()
  const { data: days, refetch } = useJournalDays(roomId, now.getFullYear(), now.getMonth() + 1)
  const todayCats = new Set(days?.[today] ?? [])
  const dayClosed = JOURNAL_CATEGORIES.every((c) => todayCats.has(c))
  const doneCount = JOURNAL_CATEGORIES.filter((c) => todayCats.has(c)).length

  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState<JournalCategory>('focus')
  const cfg = CATS.find((c) => c.key === active)!
  const key = draftKey(userId, today, active)

  const [text, setText] = useState('')
  // При переключении категории — подтянуть её черновик из localStorage.
  useEffect(() => {
    setText(localStorage.getItem(draftKey(userId, today, active)) ?? '')
  }, [active, userId, today])

  // Автосохранение черновика активной категории.
  useEffect(() => {
    if (text) localStorage.setItem(key, text)
    else localStorage.removeItem(key)
  }, [text, key])

  const sendMessage = useSendMessage(roomId)

  function publish() {
    const value = text.trim()
    if (!value) return
    // Маркер категории (невидим после рендера) + markdown-тело. Ссылки станут кликабельны.
    const heading = cfg.key === 'film' ? `## 🎬 ${value}` : cfg.heading
    const body = cfg.key === 'film' ? '' : `\n\n${value}`
    const content = `<!--journal:${cfg.key}-->\n\n${heading}${body}`

    sendMessage.mutate({ content }, {
      onSuccess: () => {
        localStorage.removeItem(key)
        setText('')
        void refetch()
      },
    })
  }

  if (!expanded) {
    return (
      <button className={styles.journalBar} onClick={() => setExpanded(true)}>
        <span>{dayClosed ? '✓ Ежедневные задания выполнены' : '📓 Выполнить ежедневные задания'}</span>
        {!dayClosed && (
          <span className={styles.journalBarProgress}>{doneCount}/{JOURNAL_CATEGORIES.length}</span>
        )}
      </button>
    )
  }

  return (
    <div className={styles.journalWrap}>
      <div className={styles.journalHead}>
        {dayClosed && <div className={styles.journalDone}>✓ День закрыт — опубликованы все категории</div>}
        <button className={styles.journalCollapse} onClick={() => setExpanded(false)}>
          Свернуть ▲
        </button>
      </div>

      <div className={styles.journalTabs}>
        {CATS.map((c) => (
          <button
            key={c.key}
            className={`${styles.journalTab} ${active === c.key ? styles.journalTabActive : ''}`}
            onClick={() => setActive(c.key)}
          >
            {c.tab}
            {todayCats.has(c.key) && <span className={styles.journalCheck}>✓</span>}
          </button>
        ))}
      </div>

      <div className={styles.journalField}>
        <label className={styles.journalLabel}>{cfg.label}</label>
        {cfg.multiline ? (
          <textarea
            className={styles.journalTextarea}
            placeholder={cfg.placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
        ) : (
          <input
            className={styles.journalInput}
            placeholder={cfg.placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
      </div>

      <button
        className={styles.journalPublish}
        onClick={publish}
        disabled={!text.trim() || sendMessage.isPending}
      >
        {sendMessage.isPending
          ? 'Публикую…'
          : todayCats.has(active)
            ? 'Опубликовать ещё'
            : 'Опубликовать'}
      </button>
    </div>
  )
}
