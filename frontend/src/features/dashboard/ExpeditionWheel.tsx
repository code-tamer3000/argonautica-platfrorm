import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useMemo } from 'react'
import { IconLock } from '../../components/icons'
import type { Element, ExpeditionOut, LockState } from '../../lib/types'
import { moonLitPath, moonLitPathMirrored, moonPhase, moonPhaseName } from './moon'
import {
  CX,
  CY,
  ELEMENT_ORDER,
  R_DAY,
  R_INNER,
  R_LABEL,
  R_LOCK,
  elementName,
  layoutWheel,
  polar,
  stageByKind,
} from './wheelGeometry'
import styles from './dashboard.module.css'

interface Props {
  expedition: ExpeditionOut
  onLockClick: (element: Element) => void
}

const fmtShort = (iso: string) => format(new Date(`${iso}T00:00:00`), 'dd.MM')

export function ExpeditionWheel({ expedition, onLockClick }: Props) {
  const layout = useMemo(() => layoutWheel(expedition), [expedition])
  const { today, days: dayStatuses } = expedition

  const currentStage = today != null ? expedition.stages.find((s) => today >= s.day_from && today <= s.day_to) : undefined

  return (
    <svg
      viewBox="0 0 660 660"
      className={styles.wheel}
      role="img"
      aria-label={`Круг Экспедиции: ${expedition.total_days} дней, четыре стихии и Точка баланса в центре`}
    >
      {/* границы квадрантов */}
      {[45, 135, 225, 315].map((a) => {
        const inner = polar(a, R_INNER + 18)
        const outer = polar(a, R_LABEL - 36)
        return (
          <line
            key={a}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            className={styles.wheelDivider}
          />
        )
      })}
      <circle cx={CX} cy={CY} r={R_DAY} className={styles.wheelRing} />
      {/* золотой отблеск, неспешно обходящий круг — единственное, что явно движется
          по всему кольцу, остальное движение локально (сегодня/замки/инь-ян) */}
      <circle
        cx={CX}
        cy={CY}
        r={R_DAY}
        className={styles.wheelSweep}
        style={{ transformOrigin: `${CX}px ${CY}px` }}
      />

      {/* подписи стихий + дата эфира */}
      {ELEMENT_ORDER.map((element) => {
        const stage = stageByKind(expedition.stages, element)
        const pos = polar(layout.labelAngle[element], R_LABEL)
        const active = currentStage?.kind === element
        return (
          <g key={element} className={active ? styles.labelActive : styles.label}>
            <text x={pos.x} y={pos.y} textAnchor="middle" className={styles.labelText}>
              {elementName(element).toUpperCase()}
            </text>
            {stage && (
              <text x={pos.x} y={pos.y + 16} textAnchor="middle" className={styles.labelDate}>
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
        const onInnerRing = d.radius === R_INNER
        const r = isToday ? (onInnerRing ? 7 : 12.5) : onInnerRing ? 4.6 : 9
        const color = d.element ? `var(--el-${d.element})` : 'var(--accent)'
        const isPast = status !== undefined && !['upcoming', 'today_open', 'today_closed'].includes(status)
        const isClosed = status === 'closed' || status === 'credited' || status === 'today_closed'
        const dim = isPast && !isClosed

        return (
          <g
            key={d.day}
            transform={`translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`}
            className={dim ? styles.dayDim : isToday ? styles.dayToday : styles.day}
          >
            <title>
              День {d.day}
              {dateIso ? ` · ${format(new Date(`${dateIso}T00:00:00`), 'd MMMM', { locale: ru })}` : ''}
              {phase ? ` · ${moonPhaseName(phase)}` : ''}
              {isToday ? ' · сегодня' : ''}
            </title>
            <circle r={r} fill="none" stroke={color} strokeWidth={isToday ? 1.4 : 1} />
            {phase && (
              <path
                d={moonLitPath(r, phase)}
                fill={color}
                transform={moonLitPathMirrored(phase) ? 'scale(-1,1)' : undefined}
              />
            )}
            {isToday && <circle r={r + 6} fill="none" className={styles.todayHalo} />}
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

      {/* центр: медленно дышащее сияние + неспешно вращающийся инь-ян — круг живой,
          а не застывшая схема */}
      <g transform={`translate(${CX} ${CY})`}>
        <circle r={40} className={styles.hubGlow} />
        <circle r={22} className={styles.hubRing} />
        <g className={styles.hubSpin}>
          <path
            d="M 0 -22 A 22 22 0 0 1 0 22 A 11 11 0 0 1 0 0 A 11 11 0 0 0 0 -22 Z"
            className={styles.hubFill}
          />
          <circle cx={0} cy={-11} r={4} className={styles.hubDotDark} />
          <circle cx={0} cy={11} r={4} className={styles.hubDotLight} />
        </g>
      </g>
      <text x={CX} y={CY + 78} textAnchor="middle" className={styles.hubTitle}>
        {currentStage ? stageCaption(currentStage.kind).toUpperCase() : 'ТОЧКА БАЛАНСА'}
      </text>
      <text x={CX} y={CY + 96} textAnchor="middle" className={styles.hubSub}>
        {today != null
          ? `день ${today} из ${expedition.total_days}`
          : 'вне круга'}
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
