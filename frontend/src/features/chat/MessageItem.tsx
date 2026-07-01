import { useEffect, useMemo, useState } from 'react'
import { useDeleteMessage, useEditMessage } from '../../api/messages'
import { usePin } from '../../api/pins'
import { useStickerMap } from '../../api/stickers'
import { Avatar } from '../../components/Avatar'
import { timeHM } from '../../lib/format'
import { renderMarkdown } from '../../lib/markdown'
import type { MessageOut, PublicUserOut } from '../../lib/types'
import { useAuth } from '../auth/AuthContext'
import { Attachment } from './Attachment'
import styles from './chat.module.css'

interface Props {
  msg: MessageOut
  continuation: boolean
  author?: PublicUserOut
  isInThread?: boolean
  editingId?: number | null
  isSelected?: boolean
  isHighlighted?: boolean
  onReply?: (msg: MessageOut) => void
  onEdit?: (msg: MessageOut) => void
  onClearEdit?: () => void
  onOpenThread?: (rootId: number) => void
  onSelect?: (id: number | null) => void
}

export function MessageItem({
  msg,
  continuation,
  author,
  isInThread,
  editingId,
  isSelected,
  isHighlighted,
  onReply,
  onEdit,
  onClearEdit,
  onOpenThread,
  onSelect,
}: Props) {
  const { user } = useAuth()
  const stickerMap = useStickerMap()
  const deleteMutation = useDeleteMessage(msg.room_id)
  const editMutation = useEditMessage(msg.room_id)
  const pinMutation = usePin(msg.room_id)

  const [editText, setEditText] = useState(msg.content ?? '')

  useEffect(() => {
    if (editingId === msg.id) setEditText(msg.content ?? '')
  }, [editingId, msg.id, msg.content])

  const name = author?.display_name ?? `Участник #${msg.sender_id}`
  const sticker = msg.sticker_id != null ? stickerMap.get(msg.sticker_id) : undefined
  const contentHtml = useMemo(
    () => (msg.content ? renderMarkdown(msg.content) : ''),
    [msg.content],
  )

  const isEditing = editingId === msg.id
  const canEdit = user?.id === msg.sender_id
  const canDelete = user?.id === msg.sender_id || user?.role === 'admin'

  const msgClass = [
    styles.msg,
    continuation ? styles.msgContinuation : '',
    isSelected ? styles.msgSelected : '',
    isHighlighted ? styles.msgHighlighted : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={msgClass}
      data-selected={isSelected || undefined}
      onClick={(e) => { e.stopPropagation(); onSelect?.(isSelected ? null : msg.id) }}
    >
      <div className={styles.msgAvatar}>
        {!continuation && <Avatar name={name} url={author?.avatar_url} size={36} />}
      </div>
      <div className={styles.msgBody}>
        {!continuation && (
          <div className={styles.msgHead}>
            <span className={styles.msgAuthor}>{name}</span>
            <span className={styles.msgTime}>{timeHM(msg.created_at)}</span>
          </div>
        )}

        {isEditing ? (
          <div className={styles.editRow}>
            <textarea
              className={styles.editInput}
              value={editText}
              onChange={e => setEditText(e.target.value)}
            />
            <div className={styles.editActions}>
              <button
                onClick={() => {
                  if (!editText.trim()) return
                  editMutation.mutate(
                    { id: msg.id, content: editText.trim() },
                    { onSuccess: () => onClearEdit?.() },
                  )
                }}
              >
                Сохранить
              </button>
              <button onClick={() => onClearEdit?.()}>Отмена</button>
            </div>
          </div>
        ) : (
          <>
            {msg.content && (
              <div
                className={`${styles.msgText} ${styles.markdown}`}
                dangerouslySetInnerHTML={{ __html: contentHtml }}
              />
            )}

            {msg.sticker_id != null && (
              sticker?.image_url
                ? <img className={styles.sticker} src={sticker.image_url} alt={sticker.keyword ?? ''} />
                : <span className={styles.msgPlaceholder}>[стикер]</span>
            )}

            {msg.attachment_ids.length > 0 && (
              <div className={styles.attachments}>
                {msg.attachment_ids.map(id => (
                  <Attachment key={id} assetId={id} />
                ))}
              </div>
            )}
          </>
        )}

        {msg.edited_at && (
          <div className={styles.msgMeta}>изменено</div>
        )}

        {msg.reply_count > 0 && !isInThread && (
          <button
            className={styles.threadLink}
            onClick={() => onOpenThread?.(msg.id)}
          >
            Тред · {msg.reply_count}
          </button>
        )}

        <div className={styles.actions}>
          <button className={styles.actionBtn} onClick={() => onReply?.(msg)}>
            Ответить
          </button>
          {canEdit && (
            <button className={styles.actionBtn} onClick={() => onEdit?.(msg)}>
              Редактировать
            </button>
          )}
          {canDelete && (
            <button
              className={styles.actionDanger}
              onClick={() => deleteMutation.mutate(msg.id)}
            >
              Удалить
            </button>
          )}
          <button className={styles.actionBtn} onClick={() => pinMutation.mutate(msg.id)}>
            Закрепить
          </button>
        </div>
      </div>
    </div>
  )
}
