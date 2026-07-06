import { useMemo } from 'react'
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

interface Props {
  activeKey: number | null
  partnerKey: number | null
  hoverKey: number | null
  frozen: boolean
  onHover: (n: number | null) => void
  onSelect: (n: number) => void
}

export function GeneKeysWheel({
  activeKey,
  partnerKey,
  hoverKey,
  frozen,
  onHover,
  onSelect,
}: Props) {
  const focusNum = hoverKey ?? activeKey
  const focusLeaf = focusNum != null ? leafOf(focusNum) : undefined
  // Partner is surfaced only as text in the caption (not highlighted on the
  // wheel), so we intentionally don't derive a partner leaf here.
  void partnerKey

  // "locked" = we're settled on the CHOSEN key (clicked, not hovering another)
  // → assemble the hexagram into one radial column. Hovering another key falls
  // back to block alignment so browsing stays fast.
  const locked = activeKey != null && (hoverKey == null || hoverKey === activeKey)
  const angles = useRings(focusNum, frozen, locked)

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

  return (
    <svg
      className={styles.wheelSvg}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="group"
      aria-label="Колесо Генных Ключей"
    >
      {/* Static ring boundaries — always visible so the three rings read as
          distinct concentric bands. */}
      {R.map((r, i) => (
        <circle key={`bound-${i}`} cx={C} cy={C} r={r} className={styles.ringBound} />
      ))}

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
              // Bigram faces the center (radial), upright via the bottom-half flip.
              const screen = angle + s.angle
              const norm = ((screen % 360) + 360) % 360
              const flip = norm > 90 && norm < 270 ? 180 : 0
              return (
                <g key={s.bits} className={cls}>
                  <path d={s.path} className={styles.lineFill} />
                  <g transform={`translate(${gx} ${gy}) rotate(${s.angle + flip})`}>
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
          // edge of the band — both radial & upright (bottom-half flip).
          const [nx, ny] = polar(C, C, R[RING_COUNT] - 18, o.leaf.angle)
          const [bx, by] = polar(C, C, R[RING_COUNT - 1] + 18, o.leaf.angle)
          const screen = angles[RING_COUNT - 1] + o.leaf.angle
          const norm = ((screen % 360) + 360) % 360
          const flip = norm > 90 && norm < 270 ? 180 : 0
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
              aria-label={`Генный Ключ ${n}`}
            >
              <path d={o.path} className={styles.keyFill} />
              <g style={{ pointerEvents: 'none' }}>
                <g transform={`translate(${bx} ${by}) rotate(${o.leaf.angle + flip})`}>
                  <RadialBigram bigram={o.leaf.addedBigram} small />
                </g>
                <g transform={`translate(${nx} ${ny}) rotate(${o.leaf.angle + flip})`}>
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

      {/* Golden edges: radial lines along the boundaries of the focused block —
          the big ¼ sector, its 4 mid-sectors and 16 leaves — growing from
          center. Rings are aligned on focus so these boundaries coincide. */}
      {focusLeaf != null && <GrowthEdges angles={angles} />}

      {/* Hub: the focused key's hexagram materialises in the center; when
          nothing is focused, the Taiji spins with the innermost ring. */}
      <circle cx={C} cy={C} r={R_HUB + 2} className={styles.hubRim} />
      {focusLeaf ? (
        <CenterHexagram bits={focusLeaf.bits} />
      ) : (
        <g style={{ transform: `rotate(${angles[0]}deg)`, transformOrigin: origin }}>
          <YinYang cx={C} cy={C} r={R_HUB - 8} />
        </g>
      )}
    </svg>
  )
}

// The focused key's full hexagram, drawn as INLINE svg shapes centered in the
// hub (a nested <svg> can't be positioned inside <g>, so we draw rects here).
function CenterHexagram({ bits }: { bits: string }) {
  const lines = bits.split('') // index 0 = line 1 (bottom)
  const w = R_HUB * 0.95
  const lineH = w * 0.11
  const gap = w * 0.14
  const totalH = lines.length * lineH + (lines.length - 1) * gap
  const gapMid = w * 0.18
  const half = (w - gapMid) / 2
  const x0 = C - w / 2
  const y0 = C - totalH / 2
  return (
    <g className={styles.centerHex}>
      {lines.map((bit, i) => {
        const rowFromTop = lines.length - 1 - i
        const y = y0 + rowFromTop * (lineH + gap)
        if (bit === '1') {
          return <rect key={i} x={x0} y={y} width={w} height={lineH} rx={lineH / 2} className={styles.centerHexLine} />
        }
        return (
          <g key={i}>
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
function GrowthEdges({ angles }: { angles: number[] }) {
  const levels = [
    { count: 4, r0: R_HUB, r1: R[1], angle: angles[0], cls: styles.edgeL1 },
    { count: 16, r0: R[1], r1: R[2], angle: angles[1], cls: styles.edgeL2 },
    { count: 64, r0: R[2], r1: R[3], angle: angles[2], cls: styles.edgeL3 },
  ]
  return (
    <g style={{ pointerEvents: 'none' }}>
      {levels.map((lv, li) => {
        const step = 360 / lv.count
        return (
          <g key={li} className={lv.cls}>
            {Array.from({ length: lv.count }, (_, i) => {
              // Sector centers sit at (i+0.5)*step; boundaries (cuts) at i*step.
              const edge = i * step + lv.angle
              const [x0, y0] = polar(C, C, lv.r0, edge)
              const [x1, y1] = polar(C, C, lv.r1, edge)
              return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={styles.growthLine} />
            })}
          </g>
        )
      })}
    </g>
  )
}
