import { useId } from 'react'

// Renders an I-Ching hexagram from a 6-char pattern ("1"=yang solid line,
// "0"=yin broken line), line 1 at the bottom, line 6 at the top.
interface Props {
  /** 6 chars of '0'/'1', line1(bottom)..line6(top). */
  pattern: string
  /** Overall width in px; height derives from it. */
  size?: number
  color?: string
  /** Play a bottom-up draw-in animation when the hexagram first appears. */
  animate?: boolean
  /** Fill the lines with a slow, looping gold sheen sweeping across them. */
  shimmer?: boolean
}

export function Hexagram({
  pattern,
  size = 22,
  color = 'currentColor',
  animate,
  shimmer,
}: Props) {
  const lines = pattern.split('') // index 0 = line 1 (bottom)
  const w = size
  const lineH = size * 0.13
  const gap = size * 0.145
  const h = lines.length * lineH + (lines.length - 1) * gap
  const gapMid = w * 0.2 // gap in the middle of a broken (yin) line

  // Each instance needs its own gradient id so multiple hexagrams don't collide.
  const gradId = useId().replace(/[:]/g, '')
  const fill = shimmer ? `url(#${gradId})` : color

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {animate && (
        // Each line grows outward from its center (scaleX 0→1), bottom-up.
        <style>{`@keyframes hexGrow{from{opacity:0;transform:scaleX(0)}to{opacity:1;transform:none}}`}</style>
      )}
      {shimmer && (
        // A bright gold band travels VERTICALLY, bottom→up through the whole
        // stacked hexagram — the "перелив золота" (flowing gold) sheen. One
        // userSpaceOnUse gradient over the full height (so it's a single sheen
        // across all six lines, not a per-line one), panned in Y via translate.
        <>
          <style>{`@keyframes gkGoldSheenV{0%{transform:translateY(${(h * 0.5).toFixed(1)}px)}50%{transform:translateY(${(-h * 0.5).toFixed(1)}px)}100%{transform:translateY(${(h * 0.5).toFixed(1)}px)}}`}</style>
          <defs>
            <linearGradient
              id={gradId}
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={0}
              x2={0}
              y2={h}
              style={{ animation: 'gkGoldSheenV 3.6s ease-in-out infinite' }}
            >
              <stop offset="0%" stopColor="var(--gk-gold-deep, #b8860b)" />
              <stop offset="42%" stopColor="var(--accent, #d4af37)" />
              <stop offset="50%" stopColor="var(--gk-gold-hi, #fff3c4)" />
              <stop offset="58%" stopColor="var(--accent, #d4af37)" />
              <stop offset="100%" stopColor="var(--gk-gold-deep, #b8860b)" />
            </linearGradient>
          </defs>
        </>
      )}
      {lines.map((bit, i) => {
        // line 1 (i=0) sits at the BOTTOM, so draw from the top down in reverse.
        const rowFromTop = lines.length - 1 - i
        const y = rowFromTop * (lineH + gap)
        // Draw-in: bottom-up, each line spreads from center to the edges.
        const style = animate
          ? ({
              animation: `hexGrow 380ms cubic-bezier(0.22,1,0.36,1) both`,
              animationDelay: `${i * 90}ms`,
              transformBox: 'fill-box',
              transformOrigin: 'center',
            } as const)
          : undefined
        if (bit === '1') {
          return (
            <rect key={i} x={0} y={y} width={w} height={lineH} rx={lineH / 2} fill={fill} style={style} />
          )
        }
        const half = (w - gapMid) / 2
        return (
          <g key={i} style={style}>
            <rect x={0} y={y} width={half} height={lineH} rx={lineH / 2} fill={fill} />
            <rect x={w - half} y={y} width={half} height={lineH} rx={lineH / 2} fill={fill} />
          </g>
        )
      })}
    </svg>
  )
}
