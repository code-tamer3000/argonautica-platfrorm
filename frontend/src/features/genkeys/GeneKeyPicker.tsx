import { useMemo, useRef, useState } from 'react'
import { TRIGRAMS, getKey, keyByTrigrams } from './wheel'
import styles from './genkeys.module.css'

// Direct key picker: the 64 wheel sectors are hard to hit (tiny on touch, fiddly
// with a cursor), so we offer two ways in — by number, or by assembling the
// hexagram from its lower + upper trigram. Selecting resolves to a key number
// and opens its reading via `onSelect`. On desktop it's a collapsible corner
// card; on mobile it sits in-flow under the wheel (styling in the CSS module).

type Mode = 'number' | 'hexagram'

// Mobile only: nudge an element into view so growing the card (hexagram) or the
// on-screen keyboard (number) doesn't leave the field hidden behind the fold.
// Desktop has room and a cursor, so we skip it there (no jarring auto-scroll).
const isTouchLayout = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches

function scrollIntoViewSoft(el: HTMLElement | null) {
  if (el && isTouchLayout()) {
    // rAF so layout has settled (card grown / keyboard cue) before we scroll.
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
}

interface Props {
  onSelect: (n: number) => void
}

export function GeneKeyPicker({ onSelect }: Props) {
  const [mode, setMode] = useState<Mode>('number')
  // Collapsed by default on DESKTOP — the picker is a compact pill until the user
  // opens it (keeps the wheel unobstructed). On mobile the toggle is hidden and
  // the content is always shown (CSS), so this state is desktop-only in effect.
  const [expanded, setExpanded] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const pick = (m: Mode) => {
    setMode(m)
    // Switching to the taller hexagram picker grows the card downward — on mobile
    // ease it into view instead of leaving it below the fold.
    if (m === 'hexagram') scrollIntoViewSoft(bodyRef.current)
  }

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
            onClick={() => pick('number')}
          >
            По номеру
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'hexagram'}
            className={mode === 'hexagram' ? styles.pickerTabActive : styles.pickerTab}
            onClick={() => pick('hexagram')}
          >
            По гексаграмме
          </button>
        </div>
        <div className={styles.pickerBody} ref={bodyRef}>
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
          // On mobile the keyboard slides up over the lower half — ease the field
          // into the center so it stays visible instead of hiding behind it.
          onFocus={(e) => scrollIntoViewSoft(e.currentTarget)}
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
