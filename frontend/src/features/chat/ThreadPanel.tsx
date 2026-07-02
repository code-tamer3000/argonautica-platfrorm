import { useEffect, useRef, useState } from 'react'
import { useMarkRead, useSendMessage } from '../../api/messages'
import { useThread } from '../../api/threads'
import { useUsersMap } from '../../api/users'
import { IconSend } from '../../components/icons'
import { Drawer } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { MessageItem } from './MessageItem'
import styles from './chat.module.css'

interface Props {
  roomId: number
  rootId: number
  canPin?: boolean
  onClose: () => void
}

export function ThreadPanel({ roomId, rootId, canPin, onClose }: Props) {
  const { data, isLoading } = useThread(roomId, rootId)
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const send = useSendMessage(roomId)
  const users = useUsersMap()
  const markRead = useMarkRead(roomId)

  // Открытый тред тоже двигает last_read_message_id — иначе его ответы
  // (id которых может быть больше, чем у последнего сообщения ленты) вечно
  // считаются непрочитанными (п.4).
  const lastReadRef = useRef(0)
  useEffect(() => {
    if (!data) return
    const maxId = Math.max(data.root.id, ...data.replies.map((r) => r.id))
    if (maxId > lastReadRef.current) {
      lastReadRef.current = maxId
      markRead.mutate(maxId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  function handleSend() {
    if (!text.trim() || send.isPending) return
    send.mutate({ content: text.trim(), reply_to_message_id: rootId })
    setText('')
  }

  return (
    <Drawer title="Тред" onClose={onClose}>
      {isLoading && (
        <div className="center" style={{ padding: 16 }}>
          <Spinner />
        </div>
      )}
      {data && (
        <>
          <MessageItem
            msg={data.root}
            continuation={false}
            author={users.get(data.root.sender_id)}
            isInThread
            canPin={canPin}
            editingId={editingId}
            onEdit={(m) => setEditingId(m.id)}
            onClearEdit={() => setEditingId(null)}
          />
          <div className={styles.threadDivider} />
          {data.replies.map((r) => (
            <MessageItem
              key={r.id}
              msg={r}
              continuation={false}
              author={users.get(r.sender_id)}
              isInThread
              canPin={canPin}
              editingId={editingId}
              onEdit={(m) => setEditingId(m.id)}
              onClearEdit={() => setEditingId(null)}
            />
          ))}
          {/* Поле ответа держим в потоке сразу под репликами (а не прибитым к низу
              панели) — на мобиле фиксированный футер уезжает вместе с клавиатурой. */}
          <div className={styles.threadReplyRow}>
            <textarea
              className={styles.composerInput}
              rows={1}
              placeholder="Ответить в тред…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            {!!text.trim() && (
              <button
                className={styles.sendBtn}
                onClick={handleSend}
                disabled={send.isPending}
                title="Ответить"
                aria-label="Ответить"
              >
                {send.isPending ? <span className={styles.spin} /> : <IconSend size={20} />}
              </button>
            )}
          </div>
        </>
      )}
    </Drawer>
  )
}
