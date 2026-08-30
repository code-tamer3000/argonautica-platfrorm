// Геометрия Круга Экспедиции — чистые функции, без React/DOM. Портировано и
// численно сверено с прототипом задачи (артефакт «Круг Экспедиции»).
//
// Обход — ПРОТИВ часовой стрелки: Воздух справа (90°) → Огонь сверху (0°) →
// Вода слева (270°) → Земля снизу (180°) — прочтение исходной схемы (стихии по
// сторонам света, порядок эфиров идёт против часовой). Дни внутри квадранта
// стихии распределяются по её фактической длине (этапы неравные — 4/6/6/5/6/1,
// не 4×7). Дни Точки Баланса и Финала — отдельным кольцом вокруг центра.

import type { Element, ExpeditionOut, StageSpanOut } from '../../lib/types'

export const CX = 330
export const CY = 330
export const R_DAY = 224
export const R_LABEL = 274
export const R_LOCK = 150
export const R_INNER = 44

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
      days.push({ day, angle, radius: R_INNER, element: null })
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
