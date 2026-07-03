import { useEffect, useRef, useState } from 'react'
import { useMarkRead, useSendMessage } from '../../api/messages'
import { useThread } from '../../api/threads'
import { useUsersMap } from '../../api/users'
import { IconSend } from '../../components/icons'
import { Drawer } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import { useAutosize } from '../../hooks/useAutosize'
import type { MessageOut } from '../../lib/types'
import { MessageActionsMenu } from './MessageActionsMenu'
import { MessageItem } from './MessageItem'
import { useMessageMenu } from './useMessageMenu'
import { VoiceComposer } from './VoiceComposer'
import styles from './chat.module.css'

interface Props {
  roomId: number
  rootId: number
  canPin?: boolean
  isNews?: boolean
  onRepost?: (msg: MessageOut) => void
  onClose: () => void
}

export function ThreadPanel({ roomId, rootId, canPin, isNews, onRepost, onClose }: Props) {
  const { data, isLoading } = useThread(roomId, rootId)
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  // Идёт запись/превью голосового ответа → прячем текстовое поле.
  const [voiceActive, setVoiceActive] = useState(false)
  const send = useSendMessage(roomId)
  const users = useUsersMap()
  const markRead = useMarkRead(roomId)
  const replyRef = useAutosize(text)
  // Контекстное меню сообщений треда. «Ответить» не показываем — мы уже в треде,
  // ответ всегда уходит в корень (п.2), для этого есть поле ввода снизу.
  const msgMenu = useMessageMenu({
    roomId,
    isNews: !!isNews,
    canPin: !!canPin,
    onEdit: (m) => setEditingId(m.id),
    onRepost,
  })

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
            forwardedFrom={data.root.forwarded_from_sender_id != null ? users.get(data.root.forwarded_from_sender_id) : undefined}
            isInThread
            editingId={editingId}
            isSelected={msgMenu.menu?.msg.id === data.root.id}
            onClearEdit={() => setEditingId(null)}
            onOpenMenu={msgMenu.openMenu}
          />
          <div className={styles.threadDivider} />
          {data.replies.map((r) => (
            <MessageItem
              key={r.id}
              msg={r}
              continuation={false}
              author={users.get(r.sender_id)}
              forwardedFrom={r.forwarded_from_sender_id != null ? users.get(r.forwarded_from_sender_id) : undefined}
              isInThread
              editingId={editingId}
              isSelected={msgMenu.menu?.msg.id === r.id}
              onClearEdit={() => setEditingId(null)}
              onOpenMenu={msgMenu.openMenu}
            />
          ))}
          {/* Поле ответа держим в потоке сразу под репликами (а не прибитым к низу
              панели) — на мобиле фиксированный футер уезжает вместе с клавиатурой. */}
          <div className={styles.threadReplyRow}>
            {!voiceActive && (
              <textarea
                ref={replyRef}
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
            )}
            {/* Есть текст → отправка; иначе — голосовой ответ (VoiceComposer шлёт с
                reply_to_message_id корня, тред остаётся плоским). */}
            {!!text.trim() && !voiceActive ? (
              <button
                className={styles.sendBtn}
                onClick={handleSend}
                disabled={send.isPending}
                title="Ответить"
                aria-label="Ответить"
              >
                {send.isPending ? <span className={styles.spin} /> : <IconSend size={20} />}
              </button>
            ) : (
              <VoiceComposer
                onSend={(assetId) =>
                  send.mutate({ attachment_ids: [assetId], reply_to_message_id: rootId })
                }
                onActiveChange={setVoiceActive}
              />
            )}
          </div>
        </>
      )}
      {msgMenu.menu && (
        <MessageActionsMenu
          anchor={msgMenu.menu.anchor}
          items={msgMenu.buildItems(msgMenu.menu.msg)}
          onClose={msgMenu.closeMenu}
        />
      )}
    </Drawer>
  )
}
