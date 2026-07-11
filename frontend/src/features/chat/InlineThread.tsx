import { useEffect, useRef, useState } from 'react'
import { useMarkRead, useSendMessage } from '../../api/messages'
import { useThread } from '../../api/threads'
import { useUsersMap } from '../../api/users'
import { IconChevronDown, IconSend } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { useAutosize } from '../../hooks/useAutosize'
import { plural } from '../../lib/format'
import type { MessageOut } from '../../lib/types'
import { MessageActionsMenu } from './MessageActionsMenu'
import { MessageItem } from './MessageItem'
import { useMentionAutocomplete } from './useMentionAutocomplete'
import { useMessageMenu } from './useMessageMenu'
import { VoiceComposer } from './VoiceComposer'
import styles from './chat.module.css'

// Сколько ответов показываем сразу; остальные — по кнопке «показать ещё». Тред
// раскрывается на последних репликах (свежее — важнее), старые прячем сверху.
const PREVIEW_COUNT = 5

interface Props {
  roomId: number
  rootId: number
  canPin?: boolean
  isNews?: boolean
  onRepost?: (msg: MessageOut) => void
  onCollapse: () => void
}

/**
 * Ветка треда, раскрытая прямо в ленте под корневым сообщением (аккордеон, не drawer).
 * Корень остаётся в ленте на своём месте — здесь показываем только ответы, поле ввода
 * и, при длинной ветке, кнопку «показать ещё». Ответ всегда уходит в корень
 * (`reply_to_message_id: rootId`) — тред плоский по построению (см. docs/MESSAGES.md).
 * Живые обновления бесплатны: `message.new` инвалидирует thread-query (см. useRealtime).
 */
export function InlineThread({ roomId, rootId, canPin, isNews, onRepost, onCollapse }: Props) {
  const { data, isLoading } = useThread(roomId, rootId)
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [expandedAll, setExpandedAll] = useState(false)
  // Идёт запись/превью голосового ответа → прячем текстовое поле.
  const [voiceActive, setVoiceActive] = useState(false)
  const send = useSendMessage(roomId)
  const users = useUsersMap()
  const markRead = useMarkRead(roomId)
  const replyRef = useAutosize(text)
  const mentions = useMentionAutocomplete(replyRef, text, setText)
  // «Ответить» в меню не показываем — мы уже в треде, ответ уходит в корень через поле снизу.
  const msgMenu = useMessageMenu({
    roomId,
    isNews: !!isNews,
    canPin: !!canPin,
    onEdit: (m) => setEditingId(m.id),
    onRepost,
  })

  // Раскрытый тред двигает last_read_message_id — иначе его ответы (id может быть
  // больше последнего сообщения ленты) вечно считались бы непрочитанными.
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
    // После своего ответа показываем ветку целиком — чтобы новое сообщение было видно.
    setExpandedAll(true)
  }

  const replies = data?.replies ?? []
  const hidden = expandedAll ? 0 : Math.max(0, replies.length - PREVIEW_COUNT)
  const shown = hidden > 0 ? replies.slice(-PREVIEW_COUNT) : replies

  return (
    <div className={styles.inlineThread}>
      <div className={styles.inlineThreadRail} />
      <div className={styles.inlineThreadBody}>
        {/* Шапка треда «прилипает» к верху скролл-области ленты, пока ветка на экране —
            кнопка «свернуть» всегда под рукой, даже в длинном треде. */}
        <div className={styles.inlineThreadHeader}>
          <button className={styles.inlineThreadCollapse} onClick={onCollapse}>
            <IconChevronDown size={16} className={styles.inlineThreadChevron} />
            Свернуть тред
          </button>
          {replies.length > 0 && (
            <span className={styles.inlineThreadCount}>
              {replies.length} {plural(replies.length, ['ответ', 'ответа', 'ответов'])}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="center" style={{ padding: 12 }}>
            <Spinner size={18} />
          </div>
        )}

        {hidden > 0 && (
          <button className={styles.inlineThreadMore} onClick={() => setExpandedAll(true)}>
            Показать ещё {hidden} {plural(hidden, ['ответ', 'ответа', 'ответов'])}
          </button>
        )}

        {shown.map((r) => (
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

        {/* Поле ответа в потоке под ветвью (не прибито к низу) — на мобиле фиксированный
            футер уезжал бы вместе с клавиатурой. */}
        <div className={styles.threadReplyRow}>
          {mentions.popup}
          {!voiceActive && (
            <textarea
              ref={replyRef}
              className={styles.composerInput}
              rows={1}
              placeholder="Ответить в тред…"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                mentions.onValueChange()
              }}
              onKeyDown={(e) => {
                if (mentions.onKeyDown(e)) return
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
              onSend={(local) =>
                send.mutate({ attachment_ids: [local.asset.id], reply_to_message_id: rootId })
              }
              onActiveChange={setVoiceActive}
            />
          )}
        </div>
      </div>

      {msgMenu.menu && (
        <MessageActionsMenu
          anchor={msgMenu.menu.anchor}
          items={msgMenu.buildItems(msgMenu.menu.msg)}
          onClose={msgMenu.closeMenu}
        />
      )}
    </div>
  )
}
