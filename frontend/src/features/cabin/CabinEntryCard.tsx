import { useState, type ReactNode } from 'react'
import { IconChevronRight } from '../../components/icons'
import type { CabinEntryOut, CabinKind } from '../../lib/types'
import { CABIN_SECTIONS } from './cabinFields'
import styles from './cabin.module.css'

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
}: {
  kind: CabinKind
  entry: CabinEntryOut
  actions?: ReactNode
  meta?: ReactNode
}) {
  const section = CABIN_SECTIONS[kind]
  const data = entry.data as unknown as Record<string, unknown>
  const [open, setOpen] = useState(false)

  // Заголовок плашки — первое поле (дата/возраст/тема); если пусто — «Без названия».
  const headline = String(data[section.titleField] || '').trim() || 'Без названия'

  // Заполненные поля (кроме заголовочного) как пары «лейбл → значение».
  const rows = section.fields
    .filter((f) => f.name !== section.titleField)
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
