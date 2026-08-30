// Геометрия Круга Экспедиции — чистые функции, без React/DOM. Портировано и
// численно сверено с прототипом задачи (артефакт «Круг Экспедиции»); слоистая
// раскладка радиусов и рамка сектора выровнены с колесом Генных Ключей
// (features/genkeys/wheel.ts) — тот же язык, другая структура данных.
//
// Обход — ПРОТИВ часовой стрелки: Воздух справа (90°) → Огонь сверху (0°) →
// Вода слева (270°) → Земля снизу (180°) — прочтение исходной схемы (стихии по
// сторонам света, порядок эфиров идёт против часовой). Дни внутри квадранта
// стихии распределяются по её фактической длине (этапы неравные — 4/6/6/5/6/1,
// не 4×7). Дни Точки Баланса и Финала — отдельным кольцом вокруг центра.

import type { Element, ExpeditionOut, StageSpanOut } from '../../lib/types'

export const CX = 330
export const CY = 330

// Слои от центра наружу (см. docs/EXPEDITION.md «Визуальный слой»).
export const R_TAIJI = 52 // инь-ян в хабе
export const R_HUB_RIM = 62 // ободок хаба
export const R_CENTER = 96 // кольцо дней Точки Баланса / Финала
export const R_LOCK = 158 // замки стихий (гексаграммы)
export const R_BAND_IN = 214 // внутренняя граница полосы стихий
export const R_LABEL = 238 // подпись стихии
export const R_LABEL_DATE = 250 // подпись даты эфира
export const R_DAY = 280 // диски-луны дней
export const R_BAND_OUT = 300 // внешняя граница полосы стихий

export const ELEMENT_ORDER: Element[] = ['air', 'fire', 'water', 'earth']
export const ELEMENT_CARDINAL: Record<Element, number> = {
  air: 90,
  fire: 0,
  water: 270,
  earth: 180,
}

// 0° = верх, растёт по часовой (обычные экранные координаты).
const rad = (angleDeg: number) => ((angleDeg - 90) * Math.PI) / 180
export function polar(angleDeg: number, r: number): { x: number; y: number } {
  return { x: CX + r * Math.cos(rad(angleDeg)), y: CY + r * Math.sin(rad(angleDeg)) }
}

export function stageByKind(stages: StageSpanOut[], kind: StageSpanOut['kind']) {
  return stages.find((s) => s.kind === kind)
}

// Квадрант стихии q (по ELEMENT_ORDER) начинается на 135° − 90q и идёт по
// убыванию угла (против часовой) — см. модуль-комментарий.
const quadrantStart = (q: number) => 135 - q * 90

/** Угол дня `p` (0-based) внутри стихии из `n` дней в её квадранте. */
export function elementDayAngle(elementIndex: number, dayIndexInStage: number, stageDays: number): number {
  return quadrantStart(elementIndex) - (dayIndexInStage + 0.5) * (90 / stageDays)
}

/** Угол дня `i` (0-based) на внутреннем кольце из `count` центральных дней. */
export function centerDayAngle(dayIndex: number, count: number): number {
  return 135 - (dayIndex + 0.5) * (360 / count)
}

/** Границы 90°-сектора стихии `elementIndex` в порядке [начало, конец] по возрастанию угла. */
export function elementSectorSpan(elementIndex: number): [number, number] {
  const start = quadrantStart(elementIndex)
  return [start - 90, start]
}

/**
 * Замкнутый контур кольцевого сектора между углами [a0, a1] (по возрастанию) и
 * радиусами [r0, r1] — две радиальные стороны + внутренняя и внешняя дуги.
 * Портировано с `sectorFramePath` из features/genkeys/GeneKeysWheel.tsx.
 */
export function sectorFramePath(a0: number, a1: number, r0: number, r1: number): string {
  const { x: x0o, y: y0o } = polar(a0, r1)
  const { x: x1o, y: y1o } = polar(a1, r1)
  const { x: x1i, y: y1i } = polar(a1, r0)
  const { x: x0i, y: y0i } = polar(a0, r0)
  const large = a1 - a0 > 180 ? 1 : 0
  return [
    `M ${x0o.toFixed(2)} ${y0o.toFixed(2)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)}`, // внешняя дуга
    `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`, // сторона
    `A ${r0} ${r0} 0 ${large} 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)}`, // внутренняя дуга
    'Z', // сторона обратно к старту
  ].join(' ')
}

export interface DayMarker {
  day: number
  angle: number
  radius: number
  element: Element | null // null — день Точки Баланса/Финала (центральное кольцо)
}

export interface WheelLayout {
  /** Все дни круга — и по ободу (стихии), и по внутреннему кольцу (баланс/финал). */
  days: DayMarker[]
  /** Позиция замка каждой стихии (кардинальный угол, радиус R_LOCK). */
  lockAngle: Record<Element, number>
  /** Позиция и текст подписи стихии (кардинальный угол, радиус R_LABEL). */
  labelAngle: Record<Element, number>
}

export function layoutWheel(expedition: ExpeditionOut): WheelLayout {
  const days: DayMarker[] = []
  const centerStages = expedition.stages.filter((s) => s.kind === 'balance' || s.kind === 'final')
  const centerDayCount = centerStages.reduce((n, s) => n + (s.day_to - s.day_from + 1), 0)

  let centerCursor = 0
  for (const stage of centerStages) {
    const stageDays = stage.day_to - stage.day_from + 1
    for (let i = 0; i < stageDays; i++) {
      const day = stage.day_from + i
      const angle = centerDayCount > 0 ? centerDayAngle(centerCursor, centerDayCount) : 0
      days.push({ day, angle, radius: R_CENTER, element: null })
      centerCursor++
    }
  }

  ELEMENT_ORDER.forEach((element, elementIndex) => {
    const stage = stageByKind(expedition.stages, element)
    if (!stage) return
    const stageDays = stage.day_to - stage.day_from + 1
    for (let i = 0; i < stageDays; i++) {
      const day = stage.day_from + i
      days.push({
        day,
        angle: elementDayAngle(elementIndex, i, stageDays),
        radius: R_DAY,
        element,
      })
    }
  })

  const lockAngle = {} as Record<Element, number>
  const labelAngle = {} as Record<Element, number>
  for (const element of ELEMENT_ORDER) {
    lockAngle[element] = ELEMENT_CARDINAL[element]
    labelAngle[element] = ELEMENT_CARDINAL[element]
  }

  return { days, lockAngle, labelAngle }
}

const ELEMENT_NAMES: Record<Element, string> = {
  air: 'Воздух',
  fire: 'Огонь',
  water: 'Вода',
  earth: 'Земля',
}
export function elementName(element: Element): string {
  return ELEMENT_NAMES[element]
}

const STAGE_NAMES: Record<StageSpanOut['kind'], string> = {
  balance: 'Точка баланса',
  air: 'Воздух',
  fire: 'Огонь',
  water: 'Вода',
  earth: 'Земля',
  final: 'Финал',
}
export function stageName(kind: StageSpanOut['kind']): string {
  return STAGE_NAMES[kind]
}
