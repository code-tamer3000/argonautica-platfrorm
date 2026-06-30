import { useEffect, useRef } from 'react'
import { Spinner } from '../../components/Spinner'
import { dayLabel, sameDay } from '../../lib/format'
import type { MessageOut, PublicUserOut } from '../../lib/types'
import { MessageItem } from './MessageItem'
import styles from './chat.module.css'

interface Props {
  messages: MessageOut[]
  hasMore: boolean
  loadMore: () => void
  loading: boolean
  users: Map<number, PublicUserOut>
}

export function MessageList({ messages, hasMore, loadMore, loading, users }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const count = messages.length

  // Автоскролл вниз при новых сообщениях, если уже были внизу.
  useEffect(() => {
    const el = ref.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [count])

  function onScroll() {
    const el = ref.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < 60 && hasMore && !loading) loadMore()
  }

  return (
    <div className={styles.messages} ref={ref} onScroll={onScroll}>
      {loading && (
        <div className="center" style={{ padding: 8 }}>
          <Spinner size={18} />
        </div>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const showDay = !prev || !sameDay(prev.created_at, m.created_at)
        const continuation = !showDay && !!prev && prev.sender_id === m.sender_id
        return (
          <div key={m.id}>
            {showDay && (
              <div className={styles.daySep}>
                <span>{dayLabel(m.created_at)}</span>
              </div>
            )}
            <MessageItem msg={m} continuation={continuation} author={users.get(m.sender_id)} />
          </div>
        )
      })}
    </div>
  )
}
