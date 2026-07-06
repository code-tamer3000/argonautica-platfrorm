// Renders an I-Ching hexagram from a 6-char pattern ("1"=yang solid line,
// "0"=yin broken line), line 1 at the bottom, line 6 at the top.
interface Props {
  /** 6 chars of '0'/'1', line1(bottom)..line6(top). */
  pattern: string
  /** Overall width in px; height derives from it. */
  size?: number
  color?: string
}

export function Hexagram({ pattern, size = 22, color = 'currentColor' }: Props) {
  const lines = pattern.split('') // index 0 = line 1 (bottom)
  const w = size
  const lineH = size * 0.11
  const gap = size * 0.13
  const h = lines.length * lineH + (lines.length - 1) * gap
  const gapMid = w * 0.16 // gap in the middle of a broken (yin) line

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {lines.map((bit, i) => {
        // line 1 (i=0) sits at the BOTTOM, so draw from the top down in reverse.
        const rowFromTop = lines.length - 1 - i
        const y = rowFromTop * (lineH + gap)
        if (bit === '1') {
          return <rect key={i} x={0} y={y} width={w} height={lineH} rx={lineH / 2} fill={color} />
        }
        const half = (w - gapMid) / 2
        return (
          <g key={i}>
            <rect x={0} y={y} width={half} height={lineH} rx={lineH / 2} fill={color} />
            <rect x={w - half} y={y} width={half} height={lineH} rx={lineH / 2} fill={color} />
          </g>
        )
      })}
    </svg>
  )
}
