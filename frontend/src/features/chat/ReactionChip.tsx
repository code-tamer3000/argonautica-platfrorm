import reactionIcon from '../../assets/reactions/star.webp'
import styles from './chat.module.css'

interface Props {
  count: number
  reactedByMe: boolean
  disabled?: boolean
  onToggle: () => void
}

// Чип реакции под сообщением — виден только когда count > 0 (первую реакцию
// ставят через пункт меню, см. useMessageMenu.tsx). Тап по чипу — toggle:
// свою реакцию снимает, иначе добавляет (см. docs/MESSAGES.md «Реакции»).
export function ReactionChip({ count, reactedByMe, disabled, onToggle }: Props) {
  if (count <= 0) return null
  return (
    <button
      type="button"
      className={`${styles.reactionChip} ${reactedByMe ? styles.reactionChipActive : ''}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <img src={reactionIcon} alt="" className={styles.reactionIcon} />
      <span>{count}</span>
    </button>
  )
}
