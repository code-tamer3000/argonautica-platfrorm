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
}

export function Hexagram({ pattern, size = 22, color = 'currentColor', animate }: Props) {
  const lines = pattern.split('') // index 0 = line 1 (bottom)
  const w = size
  const lineH = size * 0.13
  const gap = size * 0.145
  const h = lines.length * lineH + (lines.length - 1) * gap
  const gapMid = w * 0.2 // gap in the middle of a broken (yin) line

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
            <rect key={i} x={0} y={y} width={w} height={lineH} rx={lineH / 2} fill={color} style={style} />
          )
        }
        const half = (w - gapMid) / 2
        return (
          <g key={i} style={style}>
            <rect x={0} y={y} width={half} height={lineH} rx={lineH / 2} fill={color} />
            <rect x={w - half} y={y} width={half} height={lineH} rx={lineH / 2} fill={color} />
          </g>
        )
      })}
    </svg>
  )
}
