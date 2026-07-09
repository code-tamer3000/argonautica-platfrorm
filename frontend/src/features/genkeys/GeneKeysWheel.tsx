import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FAMILY_VAR,
  LEAVES,
  RINGS,
  RING_COUNT,
  annularSectorPath,
  familyOf,
  leafOf,
  polar,
  ringSectors,
  sectorSpan,
} from './wheel'
import { useRings } from './useRings'
import { YinYang } from './YinYang'
import styles from './genkeys.module.css'

const SIZE = 820
const C = SIZE / 2

// Ring boundary radii: [hub edge, ring1 out, ring2 out, ring3 out].
const R_HUB = 78
const R = [R_HUB, 176, 268, 392]

// Uniform tick geometry (same on every ring).
const TICK_LEN = 26
const TICK_H = 3.2
const TICK_GAP = 7 // between the two lines of a bigram

// How long the ambient pulse takes to travel hub→rim: the outward stagger of
// the sector-skeleton wave is spread across this window (per pulse period).
const PULSE_TRAVEL_MS = 2200

interface Props {
  activeKey: number | null
  partnerKey: number | null
  hoverKey: number | null
  frozen: boolean
  /** Scroll the outer ring so the focused key lands at top (picker selection). */
  anchorTop?: boolean
  onHover: (n: number | null) => void
  onSelect: (n: number) => void
}

export function GeneKeysWheel({
  activeKey,
  partnerKey,
  hoverKey,
  frozen,
  anchorTop = false,
  onHover,
  onSelect,
}: Props) {
  const focusNum = hoverKey ?? activeKey
  // Partner is surfaced only as text in the caption (not highlighted on the
  // wheel), so we intentionally don't derive a partner leaf here.
  void partnerKey

  const angles = useRings(focusNum, frozen, anchorTop)

  // The golden overlays (chain highlight, sector frames, center hexagram) linger
  // briefly after focus clears and fade out — so leaving the wheel feels as
  // smooth as entering it, instead of the structure popping away.
  const [lingerNum, setLingerNum] = useState<number | null>(focusNum)
  const [fading, setFading] = useState(false)
  const fadeTimer = useRef<number | null>(null)
  useEffect(() => {
    if (fadeTimer.current != null) window.clearTimeout(fadeTimer.current)
    if (focusNum != null) {
      setLingerNum(focusNum)
      setFading(false)
    } else if (lingerNum != null) {
      setFading(true)
      fadeTimer.current = window.setTimeout(() => {
        setLingerNum(null)
        setFading(false)
      }, 360)
    }
    return () => {
      if (fadeTimer.current != null) window.clearTimeout(fadeTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNum])

  const focusLeaf = lingerNum != null ? leafOf(lingerNum) : undefined

  // Decide, ONCE per focus transition, whether this is a fresh birth (came from
  // no key → play the Taiji spin-collapse + full stagger) or a key→key update
  // (only the changed lines re-draw), and remember the previously shown bits.
  // These are STATE, not per-render refs, so the classes stay stable for the
  // whole animation (a ref recomputed every rAF frame would cancel it instantly).
  const [reveal, setReveal] = useState<{ born: boolean; prevBits: string | null }>({
    born: true,
    prevBits: null,
  })
  const shownBitsRef = useRef<string | null>(null)
  useEffect(() => {
    const nextBits = lingerNum != null && !fading ? (leafOf(lingerNum)?.bits ?? null) : null
    if (nextBits == null) {
      // focus ended (or fading) — next entry will be a fresh birth
      if (shownBitsRef.current != null) shownBitsRef.current = null
      return
    }
    if (nextBits !== shownBitsRef.current) {
      setReveal({ born: shownBitsRef.current == null, prevBits: shownBitsRef.current })
      shownBitsRef.current = nextBits
    }
  }, [lingerNum, fading])
  const bornFromIdle = reveal.born
  const prevBits = reveal.prevBits

  // Inner rings 1 & 2 (bigram sectors). ring index -> radii R[idx]..R[idx+1].
  const innerRings = useMemo(
    () =>
      RINGS.filter((r) => r.level < RING_COUNT).map((r) => {
        const r0 = R[r.level - 1]
        const r1 = R[r.level]
        return {
          level: r.level,
          rMid: (r0 + r1) / 2,
          sectors: ringSectors(r.prefix).map((s) => ({
            ...s,
            path: annularSectorPath(C, C, r0, r1, s.angle - s.arc / 2, s.angle + s.arc / 2),
          })),
        }
      }),
    [],
  )

  const outer = useMemo(() => {
    const r0 = R[RING_COUNT - 1]
    const r1 = R[RING_COUNT]
    return LEAVES.map((l) => ({
      leaf: l,
      path: annularSectorPath(C, C, r0, r1, l.angle - l.arc / 2, l.angle + l.arc / 2),
      rMid: (r0 + r1) / 2,
      famVar: FAMILY_VAR[familyOf(l.key)],
    }))
  }, [])

  const origin = `${C}px ${C}px`

  // Reset hover the moment the cursor leaves the OUTER CIRCLE (not the whole
  // screen): compute the pointer's radius from center in viewBox units and drop
  // focus once it's past the key ring. Also reset on leaving the SVG entirely.
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * SIZE
    const py = ((e.clientY - rect.top) / rect.height) * SIZE
    const dist = Math.hypot(px - C, py - C)
    if (dist > R[RING_COUNT] && hoverKey != null) onHover(null)
  }

  return (
    <svg
      className={styles.wheelSvg}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="group"
      aria-label="Колесо Генных замков"
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
    >
      {/* Vertical gold sheen for the center hexagram — a bright band travelling
          bottom→up through the hub. userSpaceOnUse over the hub's vertical span
          so the whole stacked hexagram shares one moving highlight (not a
          per-line one). Animated via gradientTransform translateY. */}
      <defs>
        <linearGradient
          id="gkVertGold"
          gradientUnits="userSpaceOnUse"
          x1={C}
          y1={C - R_HUB}
          x2={C}
          y2={C + R_HUB}
          className={styles.vertGold}
        >
          <stop offset="0%" stopColor="var(--gk-gold-deep)" />
          <stop offset="38%" stopColor="var(--accent-bright)" />
          <stop offset="50%" stopColor="var(--gk-gold-hi)" />
          <stop offset="62%" stopColor="var(--accent-bright)" />
          <stop offset="100%" stopColor="var(--gk-gold-deep)" />
        </linearGradient>
      </defs>

      {/* Static ring boundaries — always visible so the three rings read as
          distinct concentric bands. */}
      {R.map((r, i) => (
        <circle key={`bound-${i}`} cx={C} cy={C} r={r} className={styles.ringBound} />
      ))}

      {/* Living skeleton: the full sector outline — every sector's radial edges
          on all three rings + the ring arcs — pulses gold in a slow wave that
          travels from the hub outward and fades, so sparks appear to run along
          the whole grid and leave a trail. Purely decorative → aria-hidden; CSS
          gates it behind prefers-reduced-motion. */}
      <SectorPulse />
      <circle cx={C} cy={C} r={R[RING_COUNT]} className={styles.rimGlow} aria-hidden="true" />

      {/* Inner rings */}
      {innerRings.map((ring) => {
        const idx = ring.level - 1
        const angle = angles[idx]
        const focusBits = focusLeaf ? focusLeaf.bits.slice(0, RINGS[idx].prefix) : null
        return (
          <g
            key={`ring-${ring.level}`}
            className={styles.ring}
            style={{ transform: `rotate(${angle}deg)`, transformOrigin: origin }}
          >
            {ring.sectors.map((s) => {
              const onChain = focusBits === s.bits
              const cls = [styles.lineCell, onChain ? styles.cellOn : '']
                .filter(Boolean)
                .join(' ')
              const [gx, gy] = polar(C, C, ring.rMid, s.angle)
              // The bigram is drawn strictly RADIAL (lower line toward center,
              // upper line outward) with NO 180° flip on the bottom half: a flip
              // would swap which line points inward, reversing the hexagram's
              // line order. The hexagram is always read from the center outward,
              // so radial orientation must be preserved on every sector.
              return (
                <g key={s.bits} className={cls}>
                  <path d={s.path} className={styles.lineFill} />
                  <g transform={`translate(${gx} ${gy}) rotate(${s.angle})`}>
                    <RadialBigram bigram={s.addedBigram} />
                  </g>
                </g>
              )
            })}
          </g>
        )
      })}

      {/* Outer ring: 64 keys */}
      <g
        className={styles.ring}
        style={{ transform: `rotate(${angles[RING_COUNT - 1]}deg)`, transformOrigin: origin }}
      >
        {outer.map((o) => {
          const n = o.leaf.key.number
          const selected = n === activeKey
          const hovered = n === hoverKey
          const cls = [
            styles.keyCell,
            selected ? styles.keySelected : '',
            hovered ? styles.keyHover : '',
          ]
            .filter(Boolean)
            .join(' ')
          // Number sits toward the outer edge, the added bigram toward the inner
          // edge of the band. The BIGRAM is drawn strictly radial (no flip) so
          // its two lines keep their center→outward order — flipping it on the
          // bottom half would reverse the hexagram's lines 5-6. The NUMBER is a
          // standalone glyph, not part of the radial line-order, so it keeps the
          // bottom-half flip that keeps it right-side up and readable.
          const [nx, ny] = polar(C, C, R[RING_COUNT] - 18, o.leaf.angle)
          const [bx, by] = polar(C, C, R[RING_COUNT - 1] + 18, o.leaf.angle)
          const screen = angles[RING_COUNT - 1] + o.leaf.angle
          const norm = ((screen % 360) + 360) % 360
          const numFlip = norm > 90 && norm < 270 ? 180 : 0
          return (
            <g
              key={n}
              className={cls}
              style={{ ['--fam' as string]: o.famVar }}
              onMouseEnter={() => onHover(n)}
              onFocus={() => onHover(n)}
              onClick={() => onSelect(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(n)
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`Генный замок ${n}`}
            >
              <path d={o.path} className={styles.keyFill} />
              <g style={{ pointerEvents: 'none' }}>
                <g transform={`translate(${bx} ${by}) rotate(${o.leaf.angle})`}>
                  <RadialBigram bigram={o.leaf.addedBigram} small />
                </g>
                <g transform={`translate(${nx} ${ny}) rotate(${o.leaf.angle + numFlip})`}>
                  <text className={styles.keyNum} textAnchor="middle" dominantBaseline="central">
                    {n}
                  </text>
                </g>
              </g>
              {/* Transparent hit area covering the whole sector (fill has gaps
                  from the 1px background stroke; this makes hover reliable). */}
              <path d={o.path} className={styles.keyHit} />
            </g>
          )
        })}
      </g>

      {/* Golden frame around the focused key's sector on each of the 3 rings —
          two radial side-edges + inner & outer arcs — a full outline per band.
          The `fading` class fades the whole overlay out smoothly on leave. */}
      {focusLeaf != null && (
        <g className={fading ? styles.overlayFading : styles.overlayIn}>
          <GrowthFrames bits={focusLeaf.bits} angles={angles} />
        </g>
      )}

      {/* Hub: the Taiji ALWAYS rotates with the inner ring (continuous, so it
          never jumps). When a key is focused it flushes gold, flattens into the
          center (scale/opacity only — rotation is untouched), and the key's
          hexagram is "born" from it; on leave the reverse plays. */}
      <circle cx={C} cy={C} r={R_HUB + 2} className={styles.hubRim} />
      <g style={{ transform: `rotate(${angles[0]}deg)`, transformOrigin: origin }}>
        <g
          // key forces the collapse/reform animation to replay on each new
          // birth (idle→key) or leave, instead of being skipped when the class
          // string happens to repeat.
          key={focusLeaf ? (fading ? 'reform' : bornFromIdle ? `born-${lingerNum}` : 'gone') : 'idle'}
          className={
            focusLeaf
              ? fading
                ? styles.taijiReform
                : bornFromIdle
                  ? styles.taijiCollapse
                  : styles.taijiGone
              : undefined
          }
          style={{ transformOrigin: origin }}
        >
          <YinYang cx={C} cy={C} r={R_HUB - 8} />
        </g>
      </g>
      {focusLeaf && (
        <g className={fading ? styles.hexCollapse : undefined} style={{ transformOrigin: origin }}>
          {/* Birth-from-idle → prevBits null so all lines stagger in (and a birth
              key forces a full remount). Key switch → only changed lines re-draw.
              Fade → prevBits === bits (no re-animation), wrapper collapses. */}
          <CenterHexagram
            key={bornFromIdle && !fading ? `born-${lingerNum}` : 'update'}
            bits={focusLeaf.bits}
            prevBits={fading ? focusLeaf.bits : bornFromIdle ? null : prevBits}
          />
        </g>
      )}
    </svg>
  )
}

// Ambient "living skeleton" pulse: the full nested sector grid — every sector's
// radial edges on all three rings + the ring arcs — rendered as faint gold
// strokes that brighten in a wave sweeping outward from the hub and fading, so
// sparks seem to run along the whole outline and leave a trail. Static geometry
// (doesn't rotate with the rings — it's the fixed lattice the wheel turns
// within), so it's computed once. Decorative; CSS gates it for reduced-motion.
function SectorPulse() {
  const { spokes, arcs } = useMemo(() => {
    // Radial spokes: at every sector boundary on each ring, a segment spanning
    // that ring's radial band. Delay grows with the band's mid-radius → the
    // wave moves outward. (Inner ring's spokes fire first, outer last.)
    const bands = [
      { count: RINGS[0].sectors, r0: R[0], r1: R[1] },
      { count: RINGS[1].sectors, r0: R[1], r1: R[2] },
      { count: RINGS[2].sectors, r0: R[2], r1: R[3] },
    ]
    const spokes: { x1: number; y1: number; x2: number; y2: number; delay: number }[] = []
    for (const b of bands) {
      for (let i = 0; i < b.count; i++) {
        const a = (i / b.count) * 360
        const [x1, y1] = polar(C, C, b.r0, a)
        const [x2, y2] = polar(C, C, b.r1, a)
        // delay from radial position of the band (0 at hub → 1 at rim)
        const mid = (b.r0 + b.r1) / 2
        const delay = ((mid - R[0]) / (R[RING_COUNT] - R[0])) * PULSE_TRAVEL_MS
        spokes.push({ x1, y1, x2, y2, delay })
      }
    }
    const arcs = R.map((r) => ({
      r,
      delay: ((r - R[0]) / (R[RING_COUNT] - R[0])) * PULSE_TRAVEL_MS,
    }))
    return { spokes, arcs }
  }, [])

  return (
    <g className={styles.sectorPulse} aria-hidden="true">
      {arcs.map((a, i) => (
        <circle
          key={`arc-${i}`}
          cx={C}
          cy={C}
          r={a.r}
          className={styles.pulseArc}
          style={{ animationDelay: `${a.delay.toFixed(0)}ms` }}
        />
      ))}
      {spokes.map((s, i) => (
        <line
          key={`spoke-${i}`}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          className={styles.pulseSpoke}
          style={{ animationDelay: `${s.delay.toFixed(0)}ms` }}
        />
      ))}
    </g>
  )
}

// The focused key's full hexagram, drawn as INLINE svg shapes centered in the
// hub (a nested <svg> can't be positioned inside <g>, so we draw rects here).
// `prevBits`: on an update, the LOWEST line that changed and everything ABOVE it
// re-draws — so a difference in line 2 re-grows lines 2-6, a difference in line 5
// re-grows lines 5-6 (a cascade upward from the first change).
function CenterHexagram({ bits, prevBits }: { bits: string; prevBits?: string | null }) {
  const lines = bits.split('') // index 0 = line 1 (bottom)
  const w = R_HUB * 0.95
  const lineH = w * 0.11
  const gap = w * 0.14
  const totalH = lines.length * lineH + (lines.length - 1) * gap
  const gapMid = w * 0.18
  const half = (w - gapMid) / 2
  const x0 = C - w / 2
  const y0 = C - totalH / 2

  // Lowest (bottom-most) line index that differs from prevBits; that line and
  // all ABOVE it re-animate. Infinity means nothing changed; 0 = full birth.
  let firstChanged = Infinity
  if (prevBits == null) firstChanged = 0
  else
    for (let i = 0; i < lines.length; i++)
      if (prevBits[i] !== lines[i]) {
        firstChanged = i
        break
      }

  return (
    <g className={styles.centerHex}>
      {lines.map((bit, i) => {
        const rowFromTop = lines.length - 1 - i
        const y = y0 + rowFromTop * (lineH + gap)
        // Cascade: this line animates if it's at or above the first change.
        const changed = i >= firstChanged
        // Bit-tagged key on changed lines forces a remount → replays grow-in.
        const key = changed ? `${i}:${bit}:${firstChanged}` : `${i}`
        // Stagger from the first changed line upward.
        const style = changed ? { animationDelay: `${(i - firstChanged) * 85}ms` } : undefined
        const cls = changed ? `${styles.centerHexLine} ${styles.lineGrow}` : styles.centerHexLine
        const gcls = changed ? styles.lineGrow : undefined
        if (bit === '1') {
          return <rect key={key} x={x0} y={y} width={w} height={lineH} rx={lineH / 2} className={cls} style={style} />
        }
        return (
          <g key={key} className={gcls} style={style}>
            <rect x={x0} y={y} width={half} height={lineH} rx={lineH / 2} className={styles.centerHexLine} />
            <rect x={x0 + w - half} y={y} width={half} height={lineH} rx={lineH / 2} className={styles.centerHexLine} />
          </g>
        )
      })}
    </g>
  )
}

// A bigram drawn RADIALLY: two horizontal I-Ching lines stacked along the
// radius, the lower line (5th line of the hexagram) nearest the center. The
// caller has already rotated the group so "toward center" = downward here.
// Solid = yang, split = yin. Uniform line length on every ring.
function RadialBigram({ bigram, small }: { bigram: string; small?: boolean }) {
  const len = small ? TICK_LEN * 0.7 : TICK_LEN
  const gap = small ? TICK_GAP : TICK_GAP + 2
  // bigram[0] = lower line (line 5, toward center) -> larger y (downward)
  const rows = [
    { bit: bigram[0], y: gap / 2 },
    { bit: bigram[1], y: -gap / 2 },
  ]
  return (
    <g>
      {rows.map((row, i) => (
        <IChingLine key={i} solid={row.bit === '1'} y={row.y} len={len} />
      ))}
    </g>
  )
}

function IChingLine({ solid, y, len }: { solid: boolean; y: number; len: number }) {
  const half = (len - TICK_GAP) / 2
  if (solid) {
    return <rect x={-len / 2} y={y - TICK_H / 2} width={len} height={TICK_H} rx={TICK_H / 2} fill="currentColor" />
  }
  return (
    <>
      <rect x={-len / 2} y={y - TICK_H / 2} width={half} height={TICK_H} rx={TICK_H / 2} fill="currentColor" />
      <rect x={len / 2 - half} y={y - TICK_H / 2} width={half} height={TICK_H} rx={TICK_H / 2} fill="currentColor" />
    </>
  )
}

// Golden grid that "cuts" the wheel into its nested sectors, ring by ring:
//   ring 1 band: 4 boundaries (÷4)   ring 2 band: 16 (÷16)   ring 3 band: 64.
// Each ring's boundaries live in that ring's radial band and rotate WITH that
// ring, so on hover (all rings aligned) they line up into continuous radial cuts,
// and grow outward from the center. Finer rings fade in slightly later.
// A closed golden outline around one sector: two radial sides + inner & outer
// arcs. `[lo,hi]` are span fractions (0..1) of the ring; `angle` is the ring's
// current rotation; `[r0,r1]` the ring's radial band.
function sectorFramePath(lo: number, hi: number, angle: number, r0: number, r1: number): string {
  const a0 = lo * 360 + angle
  const a1 = hi * 360 + angle
  const [x0o, y0o] = polar(C, C, r1, a0)
  const [x1o, y1o] = polar(C, C, r1, a1)
  const [x1i, y1i] = polar(C, C, r0, a1)
  const [x0i, y0i] = polar(C, C, r0, a0)
  const large = a1 - a0 > 180 ? 1 : 0
  return [
    `M ${x0o.toFixed(2)} ${y0o.toFixed(2)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)}`, // outer arc
    `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`, // side
    `A ${r0} ${r0} 0 ${large} 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)}`, // inner arc
    'Z', // side back to start
  ].join(' ')
}

// Golden outlines around EVERY sector on all three rings EXCEPT the focused
// chain sector (that one is filled, so it reads on its own). The outlines flow
// outward — ring 1 first, then 2, then 3, and within a ring the sectors nearest
// the focused one light up first — for a "the structure builds itself" effect.
function GrowthFrames({ bits, angles }: { bits: string; angles: number[] }) {
  const bands = [
    { prefix: RINGS[0].prefix, r0: R[0], r1: R[1], angle: angles[0], cls: styles.edgeL1, base: 0 },
    { prefix: RINGS[1].prefix, r0: R[1], r1: R[2], angle: angles[1], cls: styles.edgeL2, base: 140 },
    { prefix: RINGS[2].prefix, r0: R[2], r1: R[3], angle: angles[2], cls: styles.edgeL3, base: 280 },
  ]
  return (
    <g style={{ pointerEvents: 'none' }}>
      {bands.map((b, bi) => {
        const focusPrefix = bits.slice(0, b.prefix)
        const total = 1 << b.prefix
        return (
          <g key={bi} className={b.cls}>
            {Array.from({ length: total }, (_, i) => {
              const sb = i.toString(2).padStart(b.prefix, '0')
              if (sb === focusPrefix) return null // filled, no outline
              const [lo, hi] = sectorSpan(sb)
              // stagger by angular distance from the focused sector (nearest first)
              const [flo, fhi] = sectorSpan(focusPrefix)
              const dist = Math.abs((lo + hi) / 2 - (flo + fhi) / 2)
              const delay = b.base + dist * 360 * 3 // deg → ms-ish spread
              return (
                <path
                  key={sb}
                  d={sectorFramePath(lo, hi, b.angle, b.r0, b.r1)}
                  className={styles.growthFrame}
                  style={{ animationDelay: `${delay.toFixed(0)}ms` }}
                />
              )
            })}
          </g>
        )
      })}
    </g>
  )
}
