import { useMemo, useState } from 'react'
import {
  useCabinEntries,
  useCreateCabinEntry,
  useDeleteCabinEntry,
  useUpdateCabinEntry,
} from '../../api/cabin'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { IconPlus, IconEdit, IconTrash, IconClose } from '../../components/icons'
import { toast } from '../../stores/toast'
import type { CabinData, CabinEntryOut, CabinKind } from '../../lib/types'
import { CABIN_SECTIONS, emptyData, type FieldSpec } from './cabinFields'
import { CabinEntryCard } from './CabinEntryCard'
import styles from './cabin.module.css'

const KINDS: CabinKind[] = ['diary', 'decatastrophize', 'trigger']

export function CabinScreen() {
  const [kind, setKind] = useState<CabinKind>('diary')
  const section = CABIN_SECTIONS[kind]
  const { data: entries, isLoading } = useCabinEntries(kind)

  // Что сейчас редактируется: null — ничего, 'new' — новая плашка, число — id.
  const [editing, setEditing] = useState<number | 'new' | null>(null)

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
          <IconPlus size={18} /> Добавить запись
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

      <div className={styles.list}>
        {entries?.map((entry) =>
          editing === entry.id ? (
            <EntryForm
              key={entry.id}
              kind={kind}
              entry={entry}
              onDone={() => setEditing(null)}
            />
          ) : (
            <CabinEntryCard
              key={entry.id}
              kind={kind}
              entry={entry}
              actions={<EntryActions kind={kind} entry={entry} onEdit={() => setEditing(entry.id)} />}
            />
          ),
        )}
      </div>
    </div>
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
  const create = useCreateCabinEntry(kind)
  const update = useUpdateCabinEntry(kind)
  const isEdit = entry != null

  const [form, setForm] = useState<Record<string, string | number>>(
    () => (entry?.data as unknown as Record<string, string | number>) ?? (emptyData(kind) as unknown as Record<string, string | number>),
  )

  const busy = create.isPending || update.isPending

  const hasContent = useMemo(
    () =>
      section.fields.some((f) =>
        f.kind === 'strength' ? Number(form[f.name]) > 0 : String(form[f.name] ?? '').trim() !== '',
      ),
    [form, section.fields],
  )

  function set(name: string, value: string | number) {
    setForm((f) => ({ ...f, [name]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hasContent) return
    const data = { ...form, kind } as unknown as CabinData
    const onError = (err: unknown) =>
      toast(err instanceof Error ? err.message : 'Ошибка', 'error')

    if (isEdit && entry) {
      update.mutate(
        { id: entry.id, data },
        { onSuccess: () => { toast('Сохранено'); onDone() }, onError },
      )
    } else {
      create.mutate(data, {
        onSuccess: () => { toast('Запись добавлена'); onDone() },
        onError,
      })
    }
  }

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
        <Button type="button" variant="outline" onClick={onDone}>Отмена</Button>
        <Button type="submit" disabled={!hasContent || busy}>
          {busy ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Добавить'}
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
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {spec.label}
        {spec.hint && <span className={styles.fieldHint}> — {spec.hint}</span>}
      </span>
      {spec.kind === 'long' ? (
        <textarea
          className={styles.textarea}
          rows={2}
          maxLength={4000}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
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
