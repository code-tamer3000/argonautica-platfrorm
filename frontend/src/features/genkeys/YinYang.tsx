// Taiji (yin-yang) mark for the wheel hub. Drawn with the design-system
// bone/abyss tones rather than pure black/white so it sits in the palette.
interface Props {
  cx: number
  cy: number
  r: number
}

export function YinYang({ cx, cy, r }: Props) {
  const half = r / 2
  const dot = r / 8
  // Classic taiji path: outer circle split by two half-circles forming the S.
  const d = [
    `M ${cx} ${cy - r}`,
    `A ${r} ${r} 0 0 1 ${cx} ${cy + r}`, // right half (dark)
    `A ${half} ${half} 0 0 1 ${cx} ${cy}`, // lower bulge
    `A ${half} ${half} 0 0 0 ${cx} ${cy - r}`, // upper bulge
    'Z',
  ].join(' ')

  return (
    <g>
      {/* light field */}
      <circle cx={cx} cy={cy} r={r} fill="var(--color-kost)" />
      {/* dark swirl */}
      <path d={d} fill="var(--color-bezdna)" />
      {/* eyes */}
      <circle cx={cx} cy={cy - half} r={dot} fill="var(--color-kost)" />
      <circle cx={cx} cy={cy + half} r={dot} fill="var(--color-bezdna)" />
      {/* rim */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--divider-gold)"
        strokeWidth={1.5}
      />
    </g>
  )
}
