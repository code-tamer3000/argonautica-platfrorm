import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Spinner } from '../../components/Spinner'
import { dayLabel, sameDay } from '../../lib/format'
import type { MessageOut, PublicUserOut } from '../../lib/types'
import { MessageItem } from './MessageItem'
import styles from './chat.module.css'

export interface MessageListHandle {
  scrollToMessage: (id: number) => boolean
  isAtBottom: () => boolean
}

interface Props {
  messages: MessageOut[]
  hasMore: boolean
  loadMore: () => void
  loading: boolean
  users: Map<number, PublicUserOut>
  editingId?: number | null
  selectedMsgId?: number | null
  highlightedMsgId?: number | null
  canPin?: boolean
  onEdit?: (msg: MessageOut) => void
  onClearEdit?: () => void
  onOpenThread?: (rootId: number) => void
  onSelectMsg?: (id: number | null) => void
  onAtBottomChange?: (isBottom: boolean) => void
}

export const MessageList = forwardRef<MessageListHandle, Props>(function MessageList(
  { messages, hasMore, loadMore, loading, users, editingId, selectedMsgId, highlightedMsgId, canPin,
    onEdit, onClearEdit, onOpenThread, onSelectMsg, onAtBottomChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const count = messages.length

  // Максимальный id, известный на момент первой отрисовки ленты. Сообщения с id
  // больше этого — «новые» (пришли в реальном времени / отправлены после открытия),
  // только их анимируем. Историю и подгруженные старые страницы — не анимируем,
  // чтобы не было каскада анимаций при загрузке.
  const initialMaxId = useRef<number | null>(null)
  if (initialMaxId.current === null && count > 0) {
    initialMaxId.current = messages.reduce((max, m) => (m.id > max ? m.id : max), 0)
  }

  useImperativeHandle(ref, () => ({
    scrollToMessage(id: number) {
      const el = containerRef.current?.querySelector(`[data-msg-id="${id}"]`)
      if (!el) return false
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    },
    isAtBottom: () => atBottom.current,
  }))

  // Автоскролл вниз при новых сообщениях, если уже были внизу.
  useEffect(() => {
    const el = containerRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [count])

  function onScroll() {
    const el = containerRef.current
    if (!el) return
    const wasAtBottom = atBottom.current
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (!wasAtBottom && atBottom.current) onAtBottomChange?.(true)
    else if (wasAtBottom && !atBottom.current) onAtBottomChange?.(false)
    if (el.scrollTop < 60 && hasMore && !loading) loadMore()
  }

  return (
    <div
      className={styles.messages}
      ref={containerRef}
      onScroll={onScroll}
      onClick={() => onSelectMsg?.(null)}
    >
      {loading && (
        <div className="center" style={{ padding: 8 }}>
          <Spinner size={18} />
        </div>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const showDay = !prev || !sameDay(prev.created_at, m.created_at)
        const continuation = !showDay && !!prev && prev.sender_id === m.sender_id
        const isNew = initialMaxId.current !== null && m.id > initialMaxId.current
        return (
          <div key={m.id} data-msg-id={m.id} className={isNew ? styles.msgEnter : undefined}>
            {showDay && (
              <div className={styles.daySep}>
                <span>{dayLabel(m.created_at)}</span>
              </div>
            )}
            <MessageItem
              msg={m}
              continuation={continuation}
              author={users.get(m.sender_id)}
              editingId={editingId}
              isSelected={selectedMsgId === m.id}
              isHighlighted={highlightedMsgId === m.id}
              canPin={canPin}
              onEdit={onEdit}
              onClearEdit={onClearEdit}
              onOpenThread={onOpenThread}
              onSelect={onSelectMsg}
            />
          </div>
        )
      })}
    </div>
  )
})
