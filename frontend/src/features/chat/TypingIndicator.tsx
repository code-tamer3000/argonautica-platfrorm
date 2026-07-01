import type { PublicUserOut } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import styles from './chat.module.css'

const EMPTY: number[] = []

export function TypingIndicator({
  roomId,
  users,
}: {
  roomId: number
  users: Map<number, PublicUserOut>
}) {
  const typing = useUiStore((s) => s.typing[roomId] ?? EMPTY)
  if (typing.length === 0) return <div className={styles.typing} />
  const names = typing.map((id) => users.get(id)?.display_name ?? 'кто-то')
  const text =
    names.length === 1 ? `${names[0]} печатает…` : `${names.slice(0, 2).join(', ')} печатают…`
  return <div className={styles.typing}>{text}</div>
}
