import { Fragment, useState } from 'react'
import reactionIcon from '../../assets/reactions/star.webp'
import styles from './chat.module.css'

interface Props {
  count: number
  reactedByMe: boolean
  disabled?: boolean
  onToggle: () => void
}

function ReactionCount({ count, fromCount }: { count: number; fromCount: number | null }) {
  if (fromCount === null || fromCount === count) {
    return <span className={styles.reactionCount} aria-hidden="true">{count}</span>
  }

  const previous = String(fromCount)
  const next = String(count)
  const prefix = next.slice(0, -1)
  // Если меняется только последняя цифра, остальные остаются на месте.
  const rollStart = previous.slice(0, -1) === prefix ? prefix.length : 0

  return (
    <span className={styles.reactionCount} aria-hidden="true">
      {next.slice(0, rollStart)}
      <span className={styles.reactionCountRoll} data-direction={count > fromCount ? 'up' : 'down'}>
        <span>{previous.slice(rollStart)}</span>
        <span>{next.slice(rollStart)}</span>
      </span>
    </span>
  )
}

export function ReactionChip({ count, reactedByMe, disabled, onToggle }: Props) {
  const [confirmed, setConfirmed] = useState({ count, reactedByMe, fromCount: null as number | null })
  if (confirmed.count !== count || confirmed.reactedByMe !== reactedByMe) {
    setConfirmed({
      count,
      reactedByMe,
      // Счётчик получает подтверждённое значение, в том числе для реакций из меню.
      fromCount: confirmed.reactedByMe !== reactedByMe ? confirmed.count : null,
    })
  }

  const pulsing = confirmed.fromCount !== null
  if (count <= 0 && !pulsing) return null

  return (
    <button
      type="button"
      className={`${styles.reactionChip} ${reactedByMe ? styles.reactionChipActive : ''}`}
      aria-label={`Реакции: ${count}`}
      aria-pressed={reactedByMe}
      disabled={disabled || count <= 0}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <Fragment key={String(reactedByMe)}>
        <img
          src={reactionIcon}
          alt=""
          className={`${styles.reactionIcon} ${pulsing ? styles.reactionIconPulsing : ''}`}
          onAnimationEnd={() => setConfirmed({ ...confirmed, fromCount: null })}
        />
        <ReactionCount count={count} fromCount={confirmed.fromCount} />
      </Fragment>
    </button>
  )
}
