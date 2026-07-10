import { useEffect, useMemo, useState } from 'react'
import { useCabinEntries, useDeleteCabinEntry } from '../../api/cabin'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { IconPlus, IconEdit, IconTrash, IconClose, IconAlert } from '../../components/icons'
import { toast } from '../../stores/toast'
import { useCabinOutbox } from '../../hooks/useCabinOutbox'
import { useAutoGrow } from '../../hooks/useAutoGrow'
import { discardCabin, enqueueCabin, retryCabin } from '../../lib/cabinOutbox'
import { clearCabinDraft, loadCabinDraft, saveCabinDraft } from '../../lib/cabinDrafts'
import type { CabinData, CabinEntryOut, CabinKind, OutboxDelivery } from '../../lib/types'
import { CABIN_SECTIONS, emptyData, type FieldSpec } from './cabinFields'
import { CabinEntryCard, CabinEntryList } from './CabinEntryCard'
import styles from './cabin.module.css'

const KINDS: CabinKind[] = ['diary', 'decatastrophize', 'trigger']

export function CabinScreen() {
  const [kind, setKind] = useState<CabinKind>('diary')
  const section = CABIN_SECTIONS[kind]
  const { data: entries, isLoading } = useCabinEntries(kind)

  // Оптимистичная и надёжная (переживающая офлайн/перезагрузку) отправка форм.
  useCabinOutbox()

  // Что сейчас редактируется: null — ничего, 'new' — новая плашка, число — id.
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  // Есть ли для этого подраздела сохранённый черновик новой записи. Проверяем
  // при переключении вкладки, чтобы предложить продолжить заполнение.
  const [hasDraft, setHasDraft] = useState(false)
  useEffect(() => {
    let alive = true
    void loadCabinDraft(kind).then((d) => {
      if (alive) setHasDraft(d != null)
    })
    return () => {
      alive = false
    }
  }, [kind, editing])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Каюта</h1>

      <div className={styles.segmented} role="tablist">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? styles.segActive : styles.seg}
            onClick={() => {
              setKind(k)
              setEditing(null)
            }}
          >
            {CABIN_SECTIONS[k].title}
          </button>
        ))}
      </div>

      <p className={styles.subtitle}>{section.subtitle}</p>

      {editing === 'new' ? (
        <EntryForm
          kind={kind}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Button variant="outline" className={styles.addBtn} onClick={() => setEditing('new')}>
          <IconPlus size={18} />{' '}
          {hasDraft ? 'Продолжить черновик' : 'Добавить запись'}
        </Button>
      )}

      {isLoading && (
        <div className="center" style={{ padding: 'var(--space-8)' }}>
          <Spinner />
        </div>
      )}

      {!isLoading && (entries?.length ?? 0) === 0 && editing !== 'new' && (
        <p className={styles.empty}>Пока нет записей. Добавьте первую — заполните форму выше.</p>
      )}

      <CabinEntryList
        kind={kind}
        entries={entries ?? []}
        renderEntry={(entry) =>
          editing === entry.id ? (
            <EntryForm
              key={entry.id}
              kind={kind}
              entry={entry}
              onDone={() => setEditing(null)}
            />
          ) : entry._outbox ? (
            // Оптимистичная запись (ещё не подтверждена сервером): вместо
            // правки/удаления показываем статус доставки.
            <CabinEntryCard
              key={entry.id}
              kind={kind}
              entry={entry}
              status={<DeliveryStatus delivery={entry._outbox} />}
            />
          ) : (
            <CabinEntryCard
              key={entry.id}
              kind={kind}
              entry={entry}
              actions={<EntryActions kind={kind} entry={entry} onEdit={() => setEditing(entry.id)} />}
            />
          )
        }
      />
    </div>
  )
}

// Индикатор доставки оптимистичной записи. pending — спиннер «сохраняется»;
// failed — предупреждение с кнопками «Повторить»/«Убрать» (ручной retry/discard).
function DeliveryStatus({ delivery }: { delivery: OutboxDelivery }) {
  if (delivery.status === 'pending') {
    return (
      <span className={styles.delivery} title="Сохраняется…">
        <Spinner size={14} />
      </span>
    )
  }
  return (
    <span className={`${styles.delivery} ${styles.deliveryFailed}`}>
      <IconAlert size={14} />
      <button
        type="button"
        className={styles.deliveryBtn}
        onClick={() => retryCabin(delivery.clientId)}
      >
        Повторить
      </button>
      <button
        type="button"
        className={styles.deliveryBtn}
        onClick={() => discardCabin(delivery.clientId)}
      >
        Убрать
      </button>
    </span>
  )
}

function EntryActions({
  kind,
  entry,
  onEdit,
}: {
  kind: CabinKind
  entry: CabinEntryOut
  onEdit: () => void
}) {
  const del = useDeleteCabinEntry(kind)

  function handleDelete() {
    if (!confirm('Удалить эту запись?')) return
    del.mutate(entry.id, {
      onError: (e: unknown) => toast(e instanceof Error ? e.message : 'Ошибка', 'error'),
    })
  }

  return (
    <>
      <button className={styles.iconBtn} onClick={onEdit} aria-label="Редактировать">
        <IconEdit size={16} />
      </button>
      <button
        className={styles.iconBtn}
        onClick={handleDelete}
        disabled={del.isPending}
        aria-label="Удалить"
      >
        <IconTrash size={16} />
      </button>
    </>
  )
}

function EntryForm({
  kind,
  entry,
  onDone,
}: {
  kind: CabinKind
  entry?: CabinEntryOut
  onDone: () => void
}) {
  const section = CABIN_SECTIONS[kind]
  const isEdit = entry != null

  const [form, setForm] = useState<Record<string, string | number>>(
    () => (entry?.data as unknown as Record<string, string | number>) ?? (emptyData(kind) as unknown as Record<string, string | number>),
  )

  // Черновик — только для новой записи. Восстанавливаем один раз при открытии
  // формы (если пользователь ранее закрыл её незаполненной). У правки источник
  // истины — сервер, черновик не ведём.
  useEffect(() => {
    if (isEdit) return
    let alive = true
    void loadCabinDraft(kind).then((draft) => {
      if (alive && draft) setForm((prev) => ({ ...prev, ...draft }))
    })
    return () => {
      alive = false
    }
    // Один прогон на открытие формы конкретного подраздела (setForm стабилен).
  }, [kind, isEdit])

  const hasContent = useMemo(
    () =>
      section.fields.some((f) =>
        f.kind === 'strength' ? Number(form[f.name]) > 0 : String(form[f.name] ?? '').trim() !== '',
      ),
    [form, section.fields],
  )

  function set(name: string, value: string | number) {
    setForm((f) => {
      const next = { ...f, [name]: value }
      // Черновик пишем только для новой записи, с дебаунсом внутри saveCabinDraft.
      if (!isEdit) saveCabinDraft(kind, next)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hasContent) return
    const data = { ...form, kind } as unknown as CabinData

    // Оптимистично и надёжно: запись сразу ложится в очередь и показывается в
    // списке как «сохраняется»; фоновый воркер дошлёт её с ретраями. Форму
    // закрываем немедленно — данные уже не потеряются.
    enqueueCabin(kind, data, isEdit ? entry.id : undefined)
    if (!isEdit) clearCabinDraft(kind)
    toast(isEdit ? 'Сохраняется…' : 'Запись добавляется…')
    onDone()
  }

  // Закрытие без отправки: для новой записи черновик УЖЕ сохранён (в set), так
  // что данные не пропадут — просто закрываем.
  return (
    <form className={`${styles.form} rise`} onSubmit={handleSubmit}>
      <div className={styles.formHead}>
        <span className={styles.formTitle}>{isEdit ? 'Редактирование' : 'Новая запись'}</span>
        <button type="button" className={styles.iconBtn} onClick={onDone} aria-label="Закрыть">
          <IconClose size={18} />
        </button>
      </div>
      {section.fields.map((f) => (
        <Field key={f.name} spec={f} value={form[f.name]} onChange={(v) => set(f.name, v)} />
      ))}
      <div className={styles.formActions}>
        {!isEdit && hasContent && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearCabinDraft(kind)
              setForm(emptyData(kind) as unknown as Record<string, string | number>)
            }}
          >
            Очистить черновик
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onDone}>
          {isEdit ? 'Отмена' : 'Закрыть'}
        </Button>
        <Button type="submit" disabled={!hasContent}>
          {isEdit ? 'Сохранить' : 'Добавить'}
        </Button>
      </div>
    </form>
  )
}

function Field({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec
  value: string | number
  onChange: (v: string | number) => void
}) {
  const text = String(value ?? '')
  // Textarea растёт под текст (до ~320px), потом включается внутренний скролл —
  // чтобы длинные ответы не приходилось прокручивать в крошечном окошке.
  const grow = useAutoGrow(spec.kind === 'long' ? text : '')
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {spec.label}
        {spec.hint && <span className={styles.fieldHint}> — {spec.hint}</span>}
      </span>
      {spec.kind === 'long' ? (
        <textarea
          ref={grow.ref}
          className={styles.textarea}
          rows={2}
          maxLength={4000}
          value={text}
          onChange={(e) => {
            onChange(e.target.value)
            grow.resize()
          }}
        />
      ) : spec.kind === 'strength' ? (
        <span className={styles.strengthInput}>
          <input
            type="range"
            min={0}
            max={10}
            value={Number(value) || 0}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className={styles.strengthValue}>{Number(value) || 0}/10</span>
        </span>
      ) : (
        <input
          className={styles.input}
          maxLength={200}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}
