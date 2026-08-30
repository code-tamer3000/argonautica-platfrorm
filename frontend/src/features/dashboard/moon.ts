// Фаза луны на произвольную календарную дату — не декоративный градиент, а
// реальная физика: синодический месяц от известного новолуния (2000-01-06
// 18:14 UTC), освещённая доля k = (1 − cos θ) / 2, где θ — фаза цикла.
// Чистые функции, без DOM — проверено численно (см. прототип-артефакт задачи).

const SYNODIC_DAYS = 29.530588853
const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14)

export interface MoonPhase {
  /** Освещённая доля диска, 0 (новолуние) .. 1 (полнолуние). */
  k: number
  /** true — растёт (до полнолуния), false — убывает. */
  waxing: boolean
}

export function moonPhase(date: Date): MoonPhase {
  const ageDays =
    (((date.getTime() - KNOWN_NEW_MOON_UTC) / 86_400_000) % SYNODIC_DAYS + SYNODIC_DAYS) %
    SYNODIC_DAYS
  const theta = (2 * Math.PI * ageDays) / SYNODIC_DAYS
  return { k: (1 - Math.cos(theta)) / 2, waxing: ageDays < SYNODIC_DAYS / 2 }
}

export function moonPhaseName(p: MoonPhase): string {
  if (p.k < 0.04) return 'новолуние'
  if (p.k > 0.96) return 'полнолуние'
  if (Math.abs(p.k - 0.5) < 0.06) return p.waxing ? 'первая четверть' : 'последняя четверть'
  if (p.waxing) return p.k < 0.5 ? 'растущий серп' : 'растущая луна'
  return p.k < 0.5 ? 'убывающий серп' : 'убывающая луна'
}

/**
 * SVG-путь освещённой доли диска радиуса `r`, центр в (0,0): полуокружность +
 * дуга терминатора (эллипс с полуосью `r·|cos θ'|`, где cos θ' = 1 − 2k).
 * Путь один и тот же для растущей/убывающей фазы одного `k` — какая половина
 * освещена решает не он, а зеркальный transform на растущей стороне
 * (`scale(-1,1)`, см. `moonLitPathMirrored`) вызывающим компонентом.
 */
export function moonLitPath(r: number, phase: MoonPhase): string {
  const c = 1 - 2 * phase.k
  const rx = Math.abs(c) * r
  const sweep = c > 0 ? 0 : 1
  return `M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} A ${rx.toFixed(2)} ${r} 0 0 ${sweep} 0 ${-r}`
}

/** true — путь из `moonLitPath` нужно отразить по X (убывающая фаза). */
export function moonLitPathMirrored(phase: MoonPhase): boolean {
  return !phase.waxing
}
