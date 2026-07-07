import { useEffect, useRef, useState } from 'react'
import { RING_COUNT, leafOf } from './wheel'

// Drives all ring rotation angles (deg) with one rAF loop.
//   Idle: rings drift slowly, alternating direction, so the mandala "lives".
//   Focus (hover/active key): the OUTER ring holds (the key stays under the
//     cursor) and the inner rings ease so that the *nested sector block* the key
//     belongs to snaps into alignment — ring boundaries coincide radially so the
//     big quarter-sector exactly caps its 4 mid-sectors and 16 leaves. We align
//     each ring's containing sector CENTER to the same ray as the outer sector
//     center (not the individual key), so the whole block reads as one wedge.

export type RingAngles = number[] // length RING_COUNT, index 0 = innermost ring

// deg/sec, alternating direction; slow and meditative — a full turn takes a
// couple of minutes per ring, so the mandala breathes without spinning.
const SPEED = [-360 / 150, 360 / 120, -360 / 95]
// Spring for focus alignment. Near-critically damped (2*sqrt(K) ≈ 19) so it
// settles WITHOUT oscillating — a key change gives a soft one-way nudge, not a
// vibration.
const STIFFNESS = 90
const DAMPING = 20
// Softer, under-damped spring used briefly after a key→key nudge: the impulse
// swings the ring out, it decelerates and drifts back with a gentle overshoot —
// that residual wobble is the inertia (2*sqrt(30) ≈ 11, damping below it).
const NUDGE_STIFFNESS = 30
const NUDGE_DAMPING = 7

function shortestDelta(from: number, to: number): number {
  let d = ((((to - from) % 360) + 540) % 360) - 180
  if (d <= -180) d += 360
  return d
}

// Distinct random start angles so each ring begins out of alignment — the first
// hover on any key then has a big, satisfying wind-up as they snap together.
function randomStart(): number[] {
  return Array.from({ length: RING_COUNT }, () => Math.random() * 360)
}

// When a key is chosen from the picker (no cursor to hold the outer ring under),
// we rotate the OUTER ring too so the key travels to the top (12 o'clock) —
// that's the "scroll the wheel to the lock" motion. `anchorTop` switches this on.
export function useRings(focusKey: number | null, frozen: boolean, anchorTop = false): RingAngles {
  const initial = useRef<number[]>(randomStart())
  const [angles, setAngles] = useState<RingAngles>(() => [...initial.current])
  const ref = useRef<number[]>([...initial.current])
  const velRef = useRef<number[]>(Array(RING_COUNT).fill(0))
  // Window during which the softer, inertial spring is used (after a key→key
  // nudge), or null.
  const spinRef = useRef<{ start: number; dur: number } | null>(null)
  const focusRef = useRef<number | null>(focusKey)
  const prevFocusRef = useRef<number | null>(focusKey)
  const frozenRef = useRef(frozen)
  const anchorTopRef = useRef(anchorTop)
  focusRef.current = focusKey
  frozenRef.current = frozen
  anchorTopRef.current = anchorTop

  // Switching from one key to another: the rings are already aligned, so inject
  // a velocity impulse and let an UNDER-damped spring carry it — the ring winds
  // out, decelerates, and drifts back with a soft overshoot (real inertia, not a
  // scripted arc). Entering from idle plays no nudge (its wind-up is dynamic).
  useEffect(() => {
    const prev = prevFocusRef.current
    if (focusKey != null && prev != null && focusKey !== prev) {
      const v = velRef.current
      spinRef.current = { start: performance.now(), dur: 900 }
      for (let i = 0; i < RING_COUNT - 1; i++) {
        // deg/sec impulse, alternating direction; inner ring spins a bit more.
        const dir = i % 2 === 0 ? 1 : -1
        v[i] += dir * (150 - i * 30)
      }
    }
    prevFocusRef.current = focusKey
  }, [focusKey])

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const cur = ref.current
      const focus = focusRef.current

      const vel = velRef.current
      if (focus == null) {
        spinRef.current = null
        if (!frozenRef.current && !reduceMotion) {
          for (let i = 0; i < RING_COUNT; i++) cur[i] += SPEED[i] * dt
        }
        for (let i = 0; i < RING_COUNT; i++) vel[i] = 0
      } else {
        const leaf = leafOf(focus)
        if (leaf) {
          const outerIdx = RING_COUNT - 1
          const spin = spinRef.current
          if (spin && (now - spin.start > spin.dur || reduceMotion)) spinRef.current = null

          const nudging = spinRef.current != null && !reduceMotion
          const k = nudging ? NUDGE_STIFFNESS : STIFFNESS
          const d = nudging ? NUDGE_DAMPING : DAMPING

          // anchorTop (picker selection): spring the OUTER ring so the key lands
          // at 12 o'clock (ring rotation of -leaf.angle puts leaf.angle up top),
          // i.e. the wheel visibly scrolls the chosen lock into focus. Otherwise
          // (hover) the outer ring HOLDS — the key stays under the cursor.
          if (anchorTopRef.current) {
            const topTarget = -leaf.angle
            const disp = shortestDelta(cur[outerIdx], topTarget)
            const accel = STIFFNESS * disp - DAMPING * vel[outerIdx]
            vel[outerIdx] += accel * dt
            cur[outerIdx] += vel[outerIdx] * dt
          } else {
            vel[outerIdx] = 0
          }

          // Inner rings align to the outer ring's (current) rotation — rings are
          // geometrically NESTED, so matching rotations makes every boundary
          // coincide and the key's nested wedge assembles into one column.
          const target = cur[outerIdx]
          for (let i = 0; i < RING_COUNT - 1; i++) {
            const disp = shortestDelta(cur[i], target)
            const accel = k * disp - d * vel[i]
            vel[i] += accel * dt
            cur[i] += vel[i] * dt
          }
        }
      }

      setAngles([...cur])
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return angles
}
