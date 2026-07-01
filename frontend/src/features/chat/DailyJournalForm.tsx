import { useEffect, useState } from 'react'
import { useMessageDates, useSendMessage } from '../../api/messages'
import styles from './chat.module.css'

interface Props {
  roomId: number
  userId: number
}

function currentDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function draftKey(userId: number, dateStr: string) {
  return `journal-draft-${userId}-${dateStr}`
}

interface Draft {
  intention: string
  notes: string
  dayTitle: string
}

export function DailyJournalForm({ roomId, userId }: Props) {
  const today = currentDateStr()
  const now = new Date()
  const { data: dates, refetch } = useMessageDates(roomId, now.getFullYear(), now.getMonth() + 1)
  const todayHasEntry = (dates ?? []).includes(today)

  const key = draftKey(userId, today)
  function loadDraft(): Draft {
    try {
      const raw = localStorage.getItem(key)
      if (raw) return JSON.parse(raw) as Draft
    } catch { /* ignore */ }
    return { intention: '', notes: '', dayTitle: '' }
  }

  const [intention, setIntention] = useState(() => loadDraft().intention)
  const [notes, setNotes] = useState(() => loadDraft().notes)
  const [dayTitle, setDayTitle] = useState(() => loadDraft().dayTitle)
  const sendMessage = useSendMessage(roomId)

  // Авто-сохранение черновика в localStorage
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify({ intention, notes, dayTitle }))
  }, [intention, notes, dayTitle, key])

  if (todayHasEntry) {
    return (
      <div className={styles.journalWrap}>
        <div className={styles.journalDone}>✓ Запись дня опубликована</div>
      </div>
    )
  }

  function publish() {
    if (!intention.trim() || !dayTitle.trim()) return
    const content = [
      '🎯 Намерение',
      intention.trim(),
      '',
      notes.trim() ? '📝 Заметки' : '',
      notes.trim() ? notes.trim() : '',
      notes.trim() ? '' : '',
      '🎬 Фильм дня',
      dayTitle.trim(),
    ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n').trim()

    sendMessage.mutate({ content }, {
      onSuccess: () => {
        localStorage.removeItem(key)
        setIntention('')
        setNotes('')
        setDayTitle('')
        void refetch()
      },
    })
  }

  return (
    <div className={styles.journalWrap}>
      <div className={styles.journalField}>
        <label className={styles.journalLabel}>Намерение / концентрация дня</label>
        <textarea
          className={styles.journalTextarea}
          placeholder="На чём фокусируешься сегодня?"
          value={intention}
          onChange={e => setIntention(e.target.value)}
          rows={2}
        />
      </div>
      <div className={styles.journalField}>
        <label className={styles.journalLabel}>Заметки</label>
        <textarea
          className={styles.journalTextarea}
          placeholder="Мысли, события, наблюдения..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
        />
      </div>
      <div className={styles.journalField}>
        <label className={styles.journalLabel}>Как бы ты назвал фильм про сегодняшний день?</label>
        <input
          className={styles.journalInput}
          placeholder="Название дня..."
          value={dayTitle}
          onChange={e => setDayTitle(e.target.value)}
        />
      </div>
      <button
        className={styles.journalPublish}
        onClick={publish}
        disabled={!intention.trim() || !dayTitle.trim() || sendMessage.isPending}
      >
        {sendMessage.isPending ? 'Публикую...' : 'Опубликовать'}
      </button>
    </div>
  )
}
