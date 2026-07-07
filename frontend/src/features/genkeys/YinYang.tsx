// Taiji (yin-yang) mark for the wheel hub — paths from the supplied SVG
// (64×64 viewBox, taiji centered at 32,32, r≈30). Always monochrome (bone strand
// on the dark hub); never gold.
interface Props {
  cx: number
  cy: number
  r: number
}

// Original geometry (from yin-yang-svgrepo): center (32,32), outer r = 30.
const SRC_C = 32
const SRC_R = 30

export function YinYang({ cx, cy, r }: Props) {
  const s = r / SRC_R
  // Map the source coordinate frame onto (cx,cy,r).
  const transform = `translate(${cx} ${cy}) scale(${s}) translate(${-SRC_C} ${-SRC_C})`
  const fill = 'var(--color-kost)'
  return (
    <g transform={transform}>
      {/* filled light field so the S-curve reads as the dark strand's counter */}
      <circle cx={SRC_C} cy={SRC_C} r={SRC_R} fill="none" />
      {/* the swirling body (outer ring + S-curve) */}
      <path
        d="M32 2C15.458 2 2 15.458 2 32s13.458 30 30 30s30-13.458 30-30S48.542 2 32 2m-6.416 23.584a5.444 5.444 0 1 1-7.699-7.7a5.444 5.444 0 0 1 7.699 7.7m20.501 30.675c-4.859 1.321-10.27.086-14.086-3.729c-5.668-5.668-5.668-14.86 0-20.529c5.669-5.669 5.669-14.86 0-20.528c-3.815-3.816-9.225-5.052-14.084-3.73A27.875 27.875 0 0 1 32 3.936c15.476 0 28.064 12.589 28.064 28.064c0 10.344-5.628 19.391-13.979 24.259"
        fill={fill}
      />
      {/* the lower eye */}
      <circle cx="42.264" cy="42.263" r="5.443" fill={fill} />
    </g>
  )
}
