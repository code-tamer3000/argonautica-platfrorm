import { useState } from 'react'
import {
  useJournalPrograms,
  useCreateProgram,
  useUpdateProgram,
  useDeleteProgram,
  type JournalProgramBody,
  type JournalSectionInput,
} from '../../api/journal'
import type { JournalProgram } from '../../lib/types'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { toast } from '../../stores/toast'
import styles from './admin.module.css'

// Платформенный «сегодня»: журнальный день завершается в 03:00 МСК = 00:00 UTC,
// поэтому текущий день совпадает с UTC-датой (так же считает бэкенд).
function todayStr() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

type SectionDraft = JournalSectionInput

function emptySection(): SectionDraft {
  return { key: '', emoji: '', label: '', heading: '', placeholder: '', input_type: 'text' }
}

interface ProgramFormProps {
  initial?: JournalProgram
  submitting?: boolean
  onSubmit: (body: JournalProgramBody) => void
}

function ProgramForm({ initial, submitting, onSubmit }: ProgramFormProps) {
  const [startsOn, setStartsOn] = useState(initial?.starts_on ?? todayStr())
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [sections, setSections] = useState<SectionDraft[]>(
    initial
      ? initial.sections.map((s) => ({
          key: s.key,
          emoji: s.emoji,
          label: s.label,
          heading: s.heading,
          placeholder: s.placeholder,
          input_type: s.input_type,
        }))
      : [emptySection()],
  )

  // Активное задание нельзя менять «в прошлое» без последствий: смена состава
  // разделов пересчитает уже прожитые дни этого задания.
  const isPast = initial != null && initial.starts_on <= todayStr()

  function patch(i: number, values: Partial<SectionDraft>) {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...values } : s)))
  }
  function remove(i: number) {
    setSections((prev) => prev.filter((_, idx) => idx !== i))
  }
  function move(i: number, delta: number) {
    setSections((prev) => {
      const j = i + delta
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cleaned = sections.map((s) => ({
      key: s.key.trim(),
      emoji: s.emoji.trim(),
      label: s.label.trim(),
      // Для многострочного раздела заголовок по умолчанию — «## эмодзи подпись».
      heading:
        s.heading.trim() ||
        (s.input_type === 'text' ? `## ${s.emoji.trim()} ${s.label.trim()}`.trim() : ''),
      placeholder: s.placeholder.trim(),
      input_type: s.input_type,
    }))
    if (cleaned.length === 0) {
      toast('Нужен хотя бы один раздел', 'error')
      return
    }
    for (const s of cleaned) {
      if (!s.label) {
        toast('У каждого раздела должна быть подпись', 'error')
        return
      }
      if (!/^[a-z0-9_]+$/.test(s.key)) {
        toast(`Ключ «${s.key || '—'}»: только латиница, цифры, _`, 'error')
        return
      }
    }
    const keys = cleaned.map((s) => s.key)
    if (new Set(keys).size !== keys.length) {
      toast('Ключи разделов должны быть уникальны', 'error')
      return
    }
    onSubmit({
      starts_on: startsOn,
      title: title.trim() || null,
      description: description.trim() || null,
      sections: cleaned,
    })
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {isPast && (
        <p className={styles.mediaEmpty}>
          ⚠️ Это задание уже действует. Изменение состава разделов пересчитает уже
          прожитые дни этого задания. Правки текста/эмодзи безопасны. Чтобы поменять
          структуру «с завтра», создайте новое задание с будущей датой старта.
        </p>
      )}
      <label className={styles.label}>
        Действует с (дата старта)
        <input
          className={styles.input}
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
          required
        />
      </label>
      <label className={styles.label}>
        Название задания (необязательно)
        <input
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className={styles.label}>
        Описание (необязательно)
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className={styles.mediaSectionTitle}>Разделы дневника</div>
      {sections.map((s, i) => (
        <div className={styles.sectionCard} key={i}>
          <div className={styles.sectionRow}>
            <input
              className={styles.sectionEmoji}
              value={s.emoji}
              onChange={(e) => patch(i, { emoji: e.target.value })}
              placeholder="🎯"
              aria-label="Эмодзи"
            />
            <input
              className={styles.input}
              value={s.label}
              onChange={(e) => patch(i, { label: e.target.value })}
              placeholder="Подпись (напр. Фокус на день)"
              aria-label="Подпись"
            />
            <div className={styles.sectionButtons}>
              <button type="button" onClick={() => move(i, -1)} aria-label="Выше">↑</button>
              <button type="button" onClick={() => move(i, 1)} aria-label="Ниже">↓</button>
              <button type="button" onClick={() => remove(i)} aria-label="Удалить">✕</button>
            </div>
          </div>
          <div className={styles.sectionRow}>
            <input
              className={styles.input}
              value={s.key}
              onChange={(e) => patch(i, { key: e.target.value })}
              placeholder="ключ (латиница): focus"
              aria-label="Ключ"
            />
            <select
              className={styles.input}
              value={s.input_type}
              onChange={(e) => patch(i, { input_type: e.target.value as SectionDraft['input_type'] })}
              aria-label="Тип ввода"
            >
              <option value="text">Многострочный текст</option>
              <option value="title">Однострочный (текст → заголовок)</option>
            </select>
          </div>
          <input
            className={styles.input}
            value={s.placeholder}
            onChange={(e) => patch(i, { placeholder: e.target.value })}
            placeholder="Подсказка в поле ввода"
            aria-label="Плейсхолдер"
          />
          {s.input_type === 'text' && (
            <input
              className={styles.input}
              value={s.heading}
              onChange={(e) => patch(i, { heading: e.target.value })}
              placeholder="Заголовок записи (пусто → ## эмодзи подпись)"
              aria-label="Заголовок записи"
            />
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => setSections((prev) => [...prev, emptySection()])}
      >
        + Добавить раздел
      </Button>

      <div className={styles.formActions}>
        <Button type="submit" disabled={submitting}>Сохранить</Button>
      </div>
    </form>
  )
}

export function AdminJournal() {
  const { data: programs = [], isLoading } = useJournalPrograms()
  const createProgram = useCreateProgram()
  const updateProgram = useUpdateProgram()
  const deleteProgram = useDeleteProgram()

  const [createOpen, setCreateOpen] = useState(false)
  const [editItem, setEditItem] = useState<JournalProgram | null>(null)

  const today = todayStr()
  const activeId = [...programs]
    .reverse()
    .find((p) => p.starts_on <= today)?.id

  function onErr(err: unknown) {
    toast(err instanceof Error ? err.message : 'Ошибка', 'error')
  }

  function handleCreate(body: JournalProgramBody) {
    createProgram.mutate(body, {
      onSuccess: () => {
        toast('Задание создано')
        setCreateOpen(false)
      },
      onError: onErr,
    })
  }

  function handleEdit(body: JournalProgramBody) {
    if (!editItem) return
    updateProgram.mutate(
      { id: editItem.id, ...body },
      {
        onSuccess: () => {
          toast('Сохранено')
          setEditItem(null)
        },
        onError: onErr,
      },
    )
  }

  function handleDelete(p: JournalProgram) {
    if (!window.confirm(`Удалить задание от ${p.starts_on}?`)) return
    deleteProgram.mutate(p.id, {
      onSuccess: () => toast('Удалено'),
      onError: onErr,
    })
  }

  if (isLoading) return <div className={styles.page}><Spinner /></div>

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Структура дневника</h1>
        <Button onClick={() => setCreateOpen(true)}>Новое задание</Button>
      </div>

      <p className={styles.mediaEmpty}>
        Задание — версия структуры дневника, действующая с даты старта. День
        оценивается по заданию, активному в этот день, поэтому прошлые дни при смене
        структуры не ломаются. Прогресс (стрик/просрочки) считается непрерывно.
      </p>

      <div className={styles.list}>
        {programs.map((p) => (
          <div className={styles.listItem} key={p.id}>
            <div className={styles.listItemMain}>
              <span className={styles.listTitle}>
                {p.title || 'Без названия'}
                {p.id === activeId && ' — активно'}
              </span>
              <span className={styles.listMeta}>
                с {p.starts_on} · {p.sections.map((s) => `${s.emoji}${s.label}`).join(', ')}
              </span>
            </div>
            <div className={styles.listActions}>
              <Button variant="outline" onClick={() => setEditItem(p)}>Редактировать</Button>
              <Button variant="outline" onClick={() => handleDelete(p)}>Удалить</Button>
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <Modal title="Новое задание" onClose={() => setCreateOpen(false)}>
          <ProgramForm submitting={createProgram.isPending} onSubmit={handleCreate} />
        </Modal>
      )}

      {editItem && (
        <Modal title="Редактировать задание" onClose={() => setEditItem(null)}>
          <ProgramForm
            initial={editItem}
            submitting={updateProgram.isPending}
            onSubmit={handleEdit}
          />
        </Modal>
      )}
    </div>
  )
}
