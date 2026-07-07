import { useCallback, useEffect, useRef, useState } from 'react'
import { GeneKeysWheel } from './GeneKeysWheel'
import { GeneKeyReading } from './GeneKeyReading'
import { GeneKeyPicker } from './GeneKeyPicker'
import { getKey, partnerOf } from './wheel'
import styles from './genkeys.module.css'

// Cursor must rest on a key this long before it "locks in" — sliding across
// neighbours no longer flickers key after key; the wheel waits for you to settle.
const DWELL_MS = 260

// After a picker selection: how long the wheel scrolls the lock to the top and
// assembles its hexagram BEFORE the reading slides open.
const PICK_ASSEMBLE_MS = 1100

export function GeneKeysScreen() {
  const [hoverKey, setHoverKey] = useState<number | null>(null)
  const [activeKey, setActiveKey] = useState<number | null>(null)
  // True while a picker-chosen key is scrolling to the top / assembling — tells
  // the wheel to rotate the outer ring (there's no cursor holding it).
  const [anchorTop, setAnchorTop] = useState(false)
  const dwellRef = useRef<number | null>(null)
  const pickRef = useRef<number | null>(null)

  // Debounced hover: schedule the commit after DWELL_MS; a new hover (or leave)
  // cancels the pending one. Clearing to null is immediate (fast reset).
  const handleHover = useCallback((n: number | null) => {
    if (dwellRef.current != null) {
      window.clearTimeout(dwellRef.current)
      dwellRef.current = null
    }
    // A real hover takes over: cancel any pending picker open and stop scrolling
    // the outer ring (the cursor now holds the key).
    if (pickRef.current != null) {
      window.clearTimeout(pickRef.current)
      pickRef.current = null
    }
    setAnchorTop(false)
    if (n == null) {
      setHoverKey(null)
      return
    }
    dwellRef.current = window.setTimeout(() => {
      setHoverKey(n)
      dwellRef.current = null
    }, DWELL_MS)
  }, [])

  useEffect(
    () => () => {
      if (dwellRef.current != null) window.clearTimeout(dwellRef.current)
    },
    [],
  )

  const handleSelect = useCallback((n: number) => setActiveKey(n), [])

  // Picker selection: no cursor, so first FOCUS the key (wheel scrolls it to the
  // top and assembles the hexagram via anchorTop), then open the reading. A new
  // pick cancels the pending open.
  const handlePick = useCallback((n: number) => {
    if (pickRef.current != null) window.clearTimeout(pickRef.current)
    setAnchorTop(true)
    setHoverKey(n)
    pickRef.current = window.setTimeout(() => {
      setActiveKey(n)
      pickRef.current = null
    }, PICK_ASSEMBLE_MS)
  }, [])

  const handleClose = useCallback(() => {
    setActiveKey(null)
    setAnchorTop(false)
    setHoverKey(null)
  }, [])

  useEffect(
    () => () => {
      if (pickRef.current != null) window.clearTimeout(pickRef.current)
    },
    [],
  )

  // Esc closes the reading.
  useEffect(() => {
    if (activeKey == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeKey, handleClose])

  const open = activeKey != null
  // Partner (opposite) highlights when a key is opened OR hovered.
  const focusNum = activeKey ?? hoverKey
  const partnerKey = focusNum != null ? (partnerOf(focusNum) ?? null) : null
  const focusMeta = focusNum != null ? getKey(focusNum) : undefined
  const partnerMeta = partnerKey != null ? getKey(partnerKey) : undefined

  return (
    <div className={`${styles.screen} ${open ? styles.screenOpen : ''}`}>
      <section className={styles.stage}>
        <div className={styles.wheelWrap}>
          <GeneKeysWheel
            activeKey={activeKey}
            partnerKey={partnerKey}
            hoverKey={hoverKey}
            frozen={open}
            anchorTop={anchorTop}
            onHover={handleHover}
            onSelect={handleSelect}
          />
        </div>
        <div className={styles.caption} aria-hidden={open}>
          {focusMeta ? (
            <>
              <span className={styles.captionNum}>{focusMeta.number}</span>
              <span className={styles.captionName}>{focusMeta.name}</span>
              {partnerMeta && (
                <span className={styles.captionPartner}>
                  партнёр · {partnerMeta.number} {partnerMeta.name}
                </span>
              )}
              <span className={styles.captionHint}>нажмите, чтобы открыть</span>
            </>
          ) : (
            <>
              <span className={styles.captionTitle}>Генные замки</span>
              <span className={styles.captionHint}>наведитесь на замок · раскроется гексаграмма</span>
            </>
          )}
        </div>

        {/* Mobile-only: sectors are too small to tap, so offer direct selection
            by number or by assembling the hexagram from its two trigrams. */}
        {!open && <GeneKeyPicker onSelect={handlePick} />}
      </section>

      <div className={styles.readingPane} aria-hidden={!open}>
        {activeKey != null && <GeneKeyReading number={activeKey} onClose={handleClose} />}
      </div>
    </div>
  )
}
