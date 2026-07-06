import { useEffect, useRef, useState } from 'react'
import { RINGS, RING_COUNT, leafOf, sectorAngle } from './wheel'

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
const EASE = 3.6

function shortestDelta(from: number, to: number): number {
  let d = ((((to - from) % 360) + 540) % 360) - 180
  if (d <= -180) d += 360
  return d
}

export function useRings(
  focusKey: number | null,
  frozen: boolean,
  locked: boolean,
): RingAngles {
  const [angles, setAngles] = useState<RingAngles>(() => Array(RING_COUNT).fill(0))
  const ref = useRef<number[]>(Array(RING_COUNT).fill(0))
  const focusRef = useRef<number | null>(focusKey)
  const frozenRef = useRef(frozen)
  const lockedRef = useRef(locked)
  focusRef.current = focusKey
  frozenRef.current = frozen
  lockedRef.current = locked

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

      if (focus == null) {
        if (!frozenRef.current && !reduceMotion) {
          for (let i = 0; i < RING_COUNT; i++) cur[i] += SPEED[i] * dt
        }
      } else {
        const leaf = leafOf(focus)
        if (leaf) {
          const outerIdx = RING_COUNT - 1
          const k = 1 - Math.exp(-EASE * dt)
          if (!lockedRef.current) {
            // HOVER: align the whole nested block. Rings are geometrically NESTED
            // (reflected-binary) — ring N's sectors are ring N-1's split in four,
            // sharing boundaries — so matching all rings to the SAME rotation makes
            // every boundary coincide (big ¼ sector capping its 4 mid + 16 leaves).
            const target = cur[outerIdx]
            for (let i = 0; i < RING_COUNT; i++) {
              if (i === outerIdx) continue
              cur[i] += shortestDelta(cur[i], target) * k
            }
          } else {
            // CLICK (locked): assemble the hexagram as one radial COLUMN under the
            // key — each ring's sector *for this key* eases onto the key's ray, so
            // the three bigrams (lines 1-2, 3-4, 5-6) stack into one spoke.
            const keyScreen = cur[outerIdx] + leaf.angle // outer holds
            for (let i = 0; i < RING_COUNT; i++) {
              if (i === outerIdx) continue
              const prefix = leaf.bits.slice(0, RINGS[i].prefix)
              const target = keyScreen - sectorAngle(prefix)
              cur[i] += shortestDelta(cur[i], target) * k
            }
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
