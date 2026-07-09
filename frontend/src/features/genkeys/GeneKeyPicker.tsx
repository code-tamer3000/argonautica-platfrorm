import { useMemo, useState } from 'react'
import { TRIGRAMS, getKey, keyByTrigrams } from './wheel'
import styles from './genkeys.module.css'

// Mobile-only picker: on small screens the 64 wheel sectors are too tiny to tap
// a specific key, so we offer two direct ways in — by number, or by assembling
// the hexagram from its lower + upper trigram. Selecting resolves to a key
// number and opens its reading via `onSelect`.

type Mode = 'number' | 'hexagram'

interface Props {
  onSelect: (n: number) => void
}

export function GeneKeyPicker({ onSelect }: Props) {
  const [mode, setMode] = useState<Mode>('number')
  // Collapsed by default on DESKTOP — the picker is a compact pill until the user
  // opens it (keeps the wheel unobstructed). On mobile the toggle is hidden and
  // the content is always shown (CSS), so this state is desktop-only in effect.
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={styles.picker} data-expanded={expanded}>
      <button
        type="button"
        className={styles.pickerToggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span>Выбрать замок</span>
        <span className={styles.pickerToggleIcon} aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      <div className={styles.pickerContent}>
        <div className={styles.pickerTabs} role="tablist" aria-label="Способ выбора замка">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'number'}
            className={mode === 'number' ? styles.pickerTabActive : styles.pickerTab}
            onClick={() => setMode('number')}
          >
            По номеру
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'hexagram'}
            className={mode === 'hexagram' ? styles.pickerTabActive : styles.pickerTab}
            onClick={() => setMode('hexagram')}
          >
            По гексаграмме
          </button>
        </div>
        <div className={styles.pickerBody}>
          {mode === 'number' ? (
            <NumberPicker onSelect={onSelect} />
          ) : (
            <HexagramPicker onSelect={onSelect} />
          )}
        </div>
      </div>
    </div>
  )
}

// --- By number -------------------------------------------------------------

function NumberPicker({ onSelect }: { onSelect: (n: number) => void }) {
  const [value, setValue] = useState('')
  const num = Number(value)
  const valid = value !== '' && Number.isInteger(num) && num >= 1 && num <= 64
  const meta = valid ? getKey(num) : undefined

  const submit = () => {
    if (valid) onSelect(num)
  }

  return (
    <form
      className={styles.pickerForm}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className={styles.pickerField}>
        <span className={styles.pickerLabel}>Замок №</span>
        <input
          className={styles.pickerInput}
          type="number"
          inputMode="numeric"
          min={1}
          max={64}
          placeholder="1–64"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Номер генного замка от 1 до 64"
        />
      </label>
      <button type="submit" className={styles.pickerGo} disabled={!valid}>
        Открыть
      </button>
      <span className={styles.pickerHint} aria-live="polite">
        {value === '' ? ' ' : valid ? (meta?.name ?? ' ') : 'введите число 1–64'}
      </span>
    </form>
  )
}

// --- By hexagram (lower + upper trigram) -----------------------------------

function HexagramPicker({ onSelect }: { onSelect: (n: number) => void }) {
  const [lower, setLower] = useState<string | null>(null)
  const [upper, setUpper] = useState<string | null>(null)

  const resolved = useMemo(() => {
    if (lower == null || upper == null) return undefined
    const n = keyByTrigrams(lower, upper)
    return n != null ? getKey(n) : undefined
  }, [lower, upper])

  return (
    <div className={styles.hexPicker}>
      <TrigramColumn label="Нижняя" value={lower} onPick={setLower} />
      <TrigramColumn label="Верхняя" value={upper} onPick={setUpper} />
      <div className={styles.hexResult}>
        {resolved ? (
          <button
            type="button"
            className={styles.pickerGo}
            onClick={() => onSelect(resolved.number)}
          >
            Открыть {resolved.number} · {resolved.name}
          </button>
        ) : (
          <span className={styles.pickerHint}>выберите обе триграммы</span>
        )}
      </div>
    </div>
  )
}

function TrigramColumn({
  label,
  value,
  onPick,
}: {
  label: string
  value: string | null
  onPick: (bits: string) => void
}) {
  return (
    <div className={styles.trigramCol}>
      <span className={styles.pickerLabel}>{label}</span>
      <div className={styles.trigramGrid}>
        {TRIGRAMS.map((t) => (
          <button
            key={t.bits}
            type="button"
            className={value === t.bits ? styles.trigramBtnActive : styles.trigramBtn}
            aria-pressed={value === t.bits}
            aria-label={`${label} триграмма — ${t.name}`}
            onClick={() => onPick(t.bits)}
          >
            <TrigramLines bits={t.bits} />
            <span className={styles.trigramName}>{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Three stacked I-Ching lines; bits[0] = bottom line, drawn last (lowest).
function TrigramLines({ bits }: { bits: string }) {
  const rows = [bits[2], bits[1], bits[0]] // top-to-bottom for rendering
  return (
    <span className={styles.trigramLines} aria-hidden>
      {rows.map((bit, i) => (
        <span key={i} className={bit === '1' ? styles.trigramLineYang : styles.trigramLineYin}>
          {bit === '1' ? (
            <span className={styles.trigramSeg} />
          ) : (
            <>
              <span className={styles.trigramSeg} />
              <span className={styles.trigramSeg} />
            </>
          )}
        </span>
      ))}
    </span>
  )
}
