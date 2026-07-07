// Geometry + layout for the Gene Keys wheel — a bigram I-Ching tree.
// Pure functions only; no React, no DOM.
//
// Structure (center -> outward):
//   center : Taiji (yin-yang) — drawn by the component.
//   ring 1 : 4 sectors  = lower bigram (lines 1-2)   [inner]
//   ring 2 : 16 sectors = lines 1-4                    [middle]
//   ring 3 : 64 keys    = full hexagram               [outer, key numbers]
// Rings grow by TWO lines at a time (bigrams). A *reflected* binary split makes
// a sector and its full bit-inverse sit exactly opposite on every ring, so a
// Gene Key and its program partner (full inversion) are always 180° apart.
//
// The 64 outer leaves are additionally amino-sorted WITHIN each ring-2 group of
// 4 (via `subSlot` from genkeys.data.ts) so a key's neighbours tend to share its
// amino acid — without breaking the partner-opposite property.

import { GENE_KEYS, type GeneKeyMeta } from './genkeys.data'

// The three concrete rings and their line-prefix lengths.
export const RINGS = [
  { level: 1, prefix: 2, sectors: 4 },
  { level: 2, prefix: 4, sectors: 16 },
  { level: 3, prefix: 6, sectors: 64 },
] as const
export const RING_COUNT = RINGS.length

// --- Reflected-binary angle for an arbitrary line prefix ------------------

export function sectorSpan(bits: string): [number, number] {
  let lo = 0
  let hi = 1
  let flip = false
  for (const b of bits) {
    const mid = (lo + hi) / 2
    const eff = flip ? (b === '1' ? '0' : '1') : b
    if (eff === '1') hi = mid
    else {
      lo = mid
      flip = !flip
    }
  }
  return [lo, hi]
}
export function sectorAngle(bits: string): number {
  const [lo, hi] = sectorSpan(bits)
  return ((lo + hi) / 2) * 360
}
export function sectorArcDeg(bits: string): number {
  const [lo, hi] = sectorSpan(bits)
  return (hi - lo) * 360
}

// Outer leaf angle uses the ring-2 (lines 1-4) group center plus the amino-
// sorted subSlot offset, so equal-amino keys sit adjacent.
const GROUP_W = 360 / 16
const SUB_W = GROUP_W / 4
export function leafAngle(key: GeneKeyMeta): number {
  const groupCenter = sectorAngle(key.hexagram.slice(0, 4))
  const off = (key.subSlot - 1.5) * SUB_W
  return (groupCenter + off + 360) % 360
}

// --- Cartesian -------------------------------------------------------------

export function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

export function annularSectorPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string {
  const [x0o, y0o] = polar(cx, cy, r1, a0)
  const [x1o, y1o] = polar(cx, cy, r1, a1)
  const [x1i, y1i] = polar(cx, cy, r0, a1)
  const [x0i, y0i] = polar(cx, cy, r0, a0)
  const large = a1 - a0 > 180 ? 1 : 0
  return [
    `M ${x0o.toFixed(3)} ${y0o.toFixed(3)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1o.toFixed(3)} ${y1o.toFixed(3)}`,
    `L ${x1i.toFixed(3)} ${y1i.toFixed(3)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x0i.toFixed(3)} ${y0i.toFixed(3)}`,
    'Z',
  ].join(' ')
}

// --- Spectrum color families (design-system palette) ----------------------

export type Family = 'fire' | 'water' | 'gold' | 'stone'
const AA_FAMILY: Record<string, Family> = {
  Лизин: 'fire',
  Аргинин: 'fire',
  Гистидин: 'fire',
  'Аспарагиновая кислота': 'water',
  'Глутаминовая кислота': 'water',
  Серин: 'water',
  Треонин: 'water',
  Аспарагин: 'water',
  Глутамин: 'water',
  Тирозин: 'water',
  Цистеин: 'water',
  Фенилаланин: 'gold',
  Триптофан: 'gold',
  Пролин: 'gold',
  Метионин: 'gold',
  'Стоп-кодон': 'gold',
  Глицин: 'stone',
  Аланин: 'stone',
  Валин: 'stone',
  Лейцин: 'stone',
  Изолейцин: 'stone',
}
export function familyOf(key: GeneKeyMeta): Family {
  return AA_FAMILY[key.aminoAcid] ?? 'stone'
}
export const FAMILY_VAR: Record<Family, string> = {
  fire: 'var(--gk-fire)',
  water: 'var(--gk-water)',
  gold: 'var(--gk-gold)',
  stone: 'var(--gk-stone)',
}

// --- Lookups ---------------------------------------------------------------

export const KEYS_BY_NUMBER = new Map(GENE_KEYS.map((k) => [k.number, k]))
const HEX_TO_NUMBER = new Map(GENE_KEYS.map((k) => [k.hexagram, k.number]))

export function getKey(n: number): GeneKeyMeta | undefined {
  return KEYS_BY_NUMBER.get(n)
}
export function invert(bits: string): string {
  return bits
    .split('')
    .map((c) => (c === '1' ? '0' : '1'))
    .join('')
}
export function partnerOf(n: number): number | undefined {
  const k = KEYS_BY_NUMBER.get(n)
  if (!k) return undefined
  return HEX_TO_NUMBER.get(invert(k.hexagram))
}

// --- Precomputed sectors + leaves -----------------------------------------

export interface RingSector {
  bits: string // line prefix
  angle: number
  arc: number
  /** the two lines this ring adds (last 2 chars of bits), bottom->top */
  addedBigram: string
}
export interface Leaf {
  key: GeneKeyMeta
  angle: number
  arc: number
  bits: string
  addedBigram: string // lines 5-6
}

export function ringSectors(prefixLen: number): RingSector[] {
  const out: RingSector[] = []
  const total = 1 << prefixLen
  for (let i = 0; i < total; i++) {
    const bits = i.toString(2).padStart(prefixLen, '0')
    out.push({
      bits,
      angle: sectorAngle(bits),
      arc: sectorArcDeg(bits),
      addedBigram: bits.slice(-2),
    })
  }
  return out.sort((a, b) => a.angle - b.angle)
}

// Leaf arc: keep it uniform at 360/64 so all keys are equal-width slices.
const LEAF_ARC = 360 / 64
export const LEAVES: Leaf[] = GENE_KEYS.map((key) => ({
  key,
  bits: key.hexagram,
  angle: leafAngle(key),
  arc: LEAF_ARC,
  addedBigram: key.hexagram.slice(4, 6),
})).sort((a, b) => a.angle - b.angle)

const LEAF_BY_NUMBER = new Map(LEAVES.map((l) => [l.key.number, l]))
export function leafOf(n: number): Leaf | undefined {
  return LEAF_BY_NUMBER.get(n)
}

/** The angle of each ring's sector that contains key `n` (for chain highlight
 *  + assemble-under-key). Index 0 = ring 1 (inner) .. 2 = ring 3 (outer). */
export function chainAngles(n: number): number[] | null {
  const leaf = leafOf(n)
  if (!leaf) return null
  return RINGS.map((r) => (r.level === RING_COUNT ? leaf.angle : sectorAngle(leaf.bits.slice(0, r.prefix))))
}
