import { useState, type ReactNode } from 'react'
import { IconChevronRight } from '../../components/icons'
import type { CabinEntryOut, CabinKind } from '../../lib/types'
import { CABIN_SECTIONS } from './cabinFields'
import styles from './cabin.module.css'

/** Список записей подраздела. Если у подраздела задан `groupBy` (дневник — по
 * дате), записи собираются в раскрывающиеся группы; иначе — плоский список.
 * `renderEntry` возвращает карточку/форму на запись (у личного экрана — с
 * действиями и inline-редактированием, у админки — read-only). */
export function CabinEntryList({
  kind,
  entries,
  renderEntry,
}: {
  kind: CabinKind
  entries: CabinEntryOut[]
  renderEntry: (entry: CabinEntryOut) => ReactNode
}) {
  const section = CABIN_SECTIONS[kind]
  const groupBy = section.groupBy

  if (!groupBy) {
    return <div className={styles.list}>{entries.map(renderEntry)}</div>
  }

  // Группируем по значению поля, сохраняя порядок первого появления (записи уже
  // отсортированы — сначала новые).
  const groups: { label: string; items: CabinEntryOut[] }[] = []
  const byLabel = new Map<string, CabinEntryOut[]>()
  for (const e of entries) {
    const raw = (e.data as unknown as Record<string, unknown>)[groupBy]
    const label = String(raw ?? '').trim() || 'Без даты'
    let items = byLabel.get(label)
    if (!items) {
      items = []
      byLabel.set(label, items)
      groups.push({ label, items })
    }
    items.push(e)
  }

  return (
    <div className={styles.list}>
      {groups.map((g) => (
        <DateGroup key={g.label} label={g.label} count={g.items.length}>
          {g.items.map(renderEntry)}
        </DateGroup>
      ))}
    </div>
  )
}

/** Раскрывающаяся группа записей за одну дату. */
function DateGroup({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.dateGroup}>
      <button
        type="button"
        className={styles.dateHead}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={styles.chevron} data-open={open}>
          <IconChevronRight size={16} />
        </span>
        <span className={styles.dateLabel}>{label}</span>
        <span className={styles.dateCount}>{count}</span>
      </button>
      {open && <div className={styles.dateItems}>{children}</div>}
    </div>
  )
}

export function StrengthBadge({ value }: { value: number }) {
  return (
    <span className={styles.strengthBadge}>
      <span className={styles.strengthBar}>
        <span className={styles.strengthFill} style={{ width: `${value * 10}%` }} />
      </span>
      {value}/10
    </span>
  )
}

/** Компактная раскрывающаяся плашка записи Каюты.
 *
 * Свёрнута по умолчанию: показывает заголовок, силу и короткий превью — чтобы
 * список из многих записей (особенно в админском просмотре) оставался компактным.
 * По клику разворачивается в полный список заполненных полей. `actions` — кнопки
 * (правка/удаление) в личном экране; в админке их нет. `meta` — строка автора/даты. */
export function CabinEntryCard({
  kind,
  entry,
  actions,
  meta,
  status,
}: {
  kind: CabinKind
  entry: CabinEntryOut
  actions?: ReactNode
  meta?: ReactNode
  // Индикатор доставки оптимистичной записи (см. lib/cabinOutbox.ts); undefined
  // у обычных, уже подтверждённых сервером записей.
  status?: ReactNode
}) {
  const section = CABIN_SECTIONS[kind]
  const data = entry.data as unknown as Record<string, unknown>
  const [open, setOpen] = useState(false)

  // Заголовок плашки — первое поле (дата/возраст/тема); если пусто — «Без названия».
  const headline = String(data[section.titleField] || '').trim() || 'Без названия'

  // Заполненные поля (кроме заголовочного и поля группировки) как пары «лейбл → значение».
  const rows = section.fields
    .filter((f) => f.name !== section.titleField && f.name !== section.groupBy)
    .map((f) => ({ f, value: data[f.name] }))
    .filter(({ f, value }) =>
      f.kind === 'strength' ? Number(value) > 0 : String(value ?? '').trim() !== '',
    )

  const strength = rows.find((r) => r.f.kind === 'strength')
  // Превью в свёрнутом виде — первое заполненное текстовое поле.
  const preview = rows.find((r) => r.f.kind !== 'strength')?.value

  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <button
          type="button"
          className={styles.cardToggle}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className={styles.chevron} data-open={open}>
            <IconChevronRight size={16} />
          </span>
          <h3 className={styles.cardTitle}>{headline}</h3>
        </button>
        {strength && <StrengthBadge value={Number(strength.value)} />}
        {status}
        {actions && <div className={styles.cardActions}>{actions}</div>}
      </header>

      {meta && <div className={styles.cardMeta}>{meta}</div>}

      {!open && preview != null && (
        <p className={styles.cardPreview}>{String(preview)}</p>
      )}

      {open && (
        <dl className={styles.cardBody}>
          {rows.map(({ f, value }) => (
            <div className={styles.cardRow} key={f.name}>
              <dt className={styles.cardLabel}>{f.label}</dt>
              <dd className={styles.cardValue}>
                {f.kind === 'strength' ? (
                  <StrengthBadge value={Number(value)} />
                ) : (
                  String(value)
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}
