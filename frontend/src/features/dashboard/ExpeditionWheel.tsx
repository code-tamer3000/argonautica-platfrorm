import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useMemo } from 'react'
import { IconLock } from '../../components/icons'
import { YinYang } from '../../components/YinYang'
import type { Element, ExpeditionOut, LockState } from '../../lib/types'
import { annularSectorPath } from '../genkeys/wheel'
import { moonLitPath, moonLitPathMirrored, moonPhase, moonPhaseName } from './moon'
import {
  CX,
  CY,
  ELEMENT_ORDER,
  R_BAND_IN,
  R_BAND_OUT,
  R_CENTER,
  R_HUB_RIM,
  R_LABEL,
  R_LABEL_DATE,
  R_LOCK,
  R_TAIJI,
  elementName,
  elementSectorSpan,
  layoutWheel,
  polar,
  sectorFramePath,
  stageByKind,
} from './wheelGeometry'
import styles from './dashboard.module.css'

interface Props {
  expedition: ExpeditionOut
  onLockClick: (element: Element) => void
}

const fmtShort = (iso: string) => format(new Date(`${iso}T00:00:00`), 'dd.MM')

// Волна пульса проходит от ободка хаба до внешнего края полосы стихий за это
// время — задержка каждого элемента (арки, спицы) растёт с его радиусом, чтобы
// свечение шло от центра наружу одним фронтом (см. dashboard.module.css).
const PULSE_TRAVEL_MS = 2200
const PULSE_LAYERS = [R_HUB_RIM, R_CENTER, R_LOCK, R_BAND_IN, R_BAND_OUT]
const pulseDelay = (r: number) => ((r - R_HUB_RIM) / (R_BAND_OUT - R_HUB_RIM)) * PULSE_TRAVEL_MS

export function ExpeditionWheel({ expedition, onLockClick }: Props) {
  const layout = useMemo(() => layoutWheel(expedition), [expedition])
  const { today, days: dayStatuses } = expedition

  const currentStage = today != null ? expedition.stages.find((s) => today >= s.day_from && today <= s.day_to) : undefined
  // -1 для 'balance'/'final' (не входят в ELEMENT_ORDER) — рамка вокруг сектора
  // рисуется только для стихийных этапов, см. использование ниже.
  const currentElementIndex = currentStage ? ELEMENT_ORDER.indexOf(currentStage.kind as Element) : -1

  const bands = useMemo(
    () =>
      ELEMENT_ORDER.map((element, i) => {
        const [a0, a1] = elementSectorSpan(i)
        return { element, path: annularSectorPath(CX, CY, R_BAND_IN, R_BAND_OUT, a0, a1) }
      }),
    [],
  )

  return (
    <svg
      viewBox="0 0 660 660"
      className={styles.wheel}
      role="img"
      aria-label={`Круг Экспедиции: ${expedition.total_days} дней, четыре стихии и Точка баланса в центре`}
    >
      {/* полоса стихий — кольцевые секторы, текущий читается ярче остальных */}
      {bands.map(({ element, path }) => (
        <path
          key={element}
          d={path}
          className={currentStage?.kind === element ? styles.bandActive : styles.band}
          style={{ fill: `var(--el-${element})` }}
        />
      ))}

      {/* живая волна: арки на границах слоёв + спицы стихий, фронт идёт от хаба наружу */}
      <g aria-hidden="true" className={styles.sectorPulse}>
        {PULSE_LAYERS.map((r) => (
          <circle
            key={r}
            cx={CX}
            cy={CY}
            r={r}
            className={styles.pulseArc}
            style={{ animationDelay: `${pulseDelay(r).toFixed(0)}ms` }}
          />
        ))}
        {[45, 135, 225, 315].map((a) => {
          const inner = polar(a, R_BAND_IN)
          const outer = polar(a, R_BAND_OUT)
          return (
            <line
              key={a}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              className={styles.pulseSpoke}
              style={{ animationDelay: `${pulseDelay(R_BAND_IN).toFixed(0)}ms` }}
            />
          )
        })}
      </g>
      <circle
        cx={CX}
        cy={CY}
        r={R_BAND_OUT}
        className={styles.rimGlow}
        style={{ animationDelay: `${PULSE_TRAVEL_MS}ms` }}
      />

      {/* золотая рамка вокруг сектора текущего этапа */}
      {currentElementIndex >= 0 && (
        <path
          d={sectorFramePath(...elementSectorSpan(currentElementIndex), R_BAND_IN, R_BAND_OUT)}
          className={styles.currentFrame}
        />
      )}

      {/* подписи стихий + дата эфира */}
      {ELEMENT_ORDER.map((element) => {
        const stage = stageByKind(expedition.stages, element)
        const labelPos = polar(layout.labelAngle[element], R_LABEL)
        const datePos = polar(layout.labelAngle[element], R_LABEL_DATE)
        const active = currentStage?.kind === element
        return (
          <g key={element} className={active ? styles.labelActive : styles.label}>
            <text x={labelPos.x} y={labelPos.y} textAnchor="middle" className={styles.labelText}>
              {elementName(element).toUpperCase()}
            </text>
            {stage && (
              <text x={datePos.x} y={datePos.y} textAnchor="middle" className={styles.labelDate}>
                эфир {fmtShort(stage.air_date)}
              </text>
            )}
          </g>
        )
      })}

      {/* дни: диски луны */}
      {layout.days.map((d) => {
        const status = dayStatuses[d.day - 1]?.status
        const dateIso = dayStatuses[d.day - 1]?.date
        const isToday = d.day === today
        const phase = dateIso ? moonPhase(new Date(`${dateIso}T00:00:00`)) : null
        const pos = polar(d.angle, d.radius)
        const onCenterRing = d.radius === R_CENTER
        const r = isToday ? (onCenterRing ? 7 : 12.5) : onCenterRing ? 4.6 : 9
        const color = d.element ? `var(--el-${d.element})` : 'var(--accent)'
        // Прошедший день зачтён (закрыт/зачтён/помилован) или пропущен; будущий
        // день ещё не наступил — три разных начертания, не два (см. docs/EXPEDITION.md).
        const isDone = status === 'closed' || status === 'credited' || status === 'today_closed' || status === 'pardoned'
        const isMissed = status === 'missed'
        const dayClass = isToday ? styles.dayToday : isDone ? styles.dayDone : isMissed ? styles.dayMissed : styles.dayFuture
        const showMoon = phase != null && (isToday || isDone)

        return (
          <g key={d.day} transform={`translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`} className={dayClass}>
            <title>
              День {d.day}
              {dateIso ? ` · ${format(new Date(`${dateIso}T00:00:00`), 'd MMMM', { locale: ru })}` : ''}
              {phase ? ` · ${moonPhaseName(phase)}` : ''}
              {isToday ? ' · сегодня' : ''}
            </title>
            <circle r={r} fill="none" stroke={color} strokeWidth={isToday ? 1.4 : 1} />
            {showMoon && phase && (
              <path
                d={moonLitPath(r, phase)}
                fill={color}
                transform={moonLitPathMirrored(phase) ? 'scale(-1,1)' : undefined}
              />
            )}
            {isToday && (
              <circle
                r={r + 6}
                fill="none"
                className={styles.todayHalo}
                style={{ animationDelay: `${pulseDelay(d.radius).toFixed(0)}ms` }}
              />
            )}
          </g>
        )
      })}

      {/* замки стихий */}
      {ELEMENT_ORDER.map((element) => (
        <LockMark
          key={element}
          element={element}
          angle={layout.lockAngle[element]}
          state={expedition.lock_states[element]}
          hexagram={expedition.locks[element]?.hexagram}
          onClick={() => onLockClick(element)}
        />
      ))}

      {/* хаб: ободок + непрерывно вращающийся инь-ян (transform-origin строго в
          координатах круга — иначе несимметричный путь тайцзи мотает мимо центра) */}
      <circle cx={CX} cy={CY} r={R_HUB_RIM} className={styles.hubGlow} />
      <circle cx={CX} cy={CY} r={R_HUB_RIM} className={styles.hubRing} />
      <g className={styles.hubSpin} style={{ transformOrigin: `${CX}px ${CY}px` }}>
        <YinYang cx={CX} cy={CY} r={R_TAIJI} />
      </g>
      <text x={CX} y={CY + 72} textAnchor="middle" className={styles.hubTitle}>
        {currentStage ? stageCaption(currentStage.kind).toUpperCase() : 'ТОЧКА БАЛАНСА'}
      </text>
      <text x={CX} y={CY + 88} textAnchor="middle" className={styles.hubSub}>
        {today != null ? `день ${today} из ${expedition.total_days}` : 'вне круга'}
      </text>
    </svg>
  )
}

function stageCaption(kind: string): string {
  if (kind === 'balance') return 'Точка баланса'
  if (kind === 'final') return 'Финал'
  return elementName(kind as Element)
}

function LockMark({
  element,
  angle,
  state,
  hexagram,
  onClick,
}: {
  element: Element
  angle: number
  state: LockState
  hexagram: string | undefined
  onClick: () => void
}) {
  const pos = polar(angle, R_LOCK)
  const interactive = state === 'unlockable' || state === 'entered' || state === 'revealed'
  const label = `${elementName(element)}: замок ${LOCK_STATE_LABEL[state]}`

  return (
    <g
      transform={`translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`}
      className={styles.lockMark}
      data-state={state}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <title>{label}</title>
      {hexagram ? (
        <HexagramLines pattern={hexagram} />
      ) : (
        <foreignObject x={-13} y={-13} width={26} height={26}>
          <div className={styles.lockIcon}>
            <IconLock size={18} strokeWidth={1.6} />
          </div>
        </foreignObject>
      )}
    </g>
  )
}

const LOCK_STATE_LABEL: Record<LockState, string> = {
  locked: 'ждёт своего этапа',
  unlockable: 'открыт — введите гексаграмму',
  entered: 'введён',
  revealed: 'раскрыт',
}

// Шесть линий гексаграммы прямо в координатах круга — не вложенный <svg> (проще
// позиционировать и красить состояниями замка через CSS, см. .lockMark[data-state]).
function HexagramLines({ pattern }: { pattern: string }) {
  const w = 20
  const lh = 2.6
  const gap = 3.1
  const h = 6 * lh + 5 * gap
  return (
    <g>
      {pattern.split('').map((bit, i) => {
        const y = h / 2 - i * (lh + gap) - lh
        if (bit === '1') {
          return <rect key={i} x={-w / 2} y={y} width={w} height={lh} rx={lh / 2} className={styles.hexLine} />
        }
        const seg = w * 0.38
        return (
          <g key={i}>
            <rect x={-w / 2} y={y} width={seg} height={lh} rx={lh / 2} className={styles.hexLine} />
            <rect x={w / 2 - seg} y={y} width={seg} height={lh} rx={lh / 2} className={styles.hexLine} />
          </g>
        )
      })}
    </g>
  )
}
