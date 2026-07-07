import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useEditMessage } from '../../api/messages'
import { useStickerMap } from '../../api/stickers'
import { Avatar } from '../../components/Avatar'
import { timeHM } from '../../lib/format'
import { renderMarkdown } from '../../lib/markdown'
import type { MessageOut, PublicUserOut } from '../../lib/types'
import { Attachment } from './Attachment'
import styles from './chat.module.css'

interface Props {
  msg: MessageOut
  continuation: boolean
  author?: PublicUserOut
  forwardedFrom?: PublicUserOut
  isInThread?: boolean
  editingId?: number | null
  isSelected?: boolean
  isHighlighted?: boolean
  onClearEdit?: () => void
  onOpenThread?: (rootId: number) => void
  // Тап по сообщению → открыть контекстное меню действий (позиция = rect сообщения).
  onOpenMenu?: (msg: MessageOut, anchor: DOMRect) => void
}

export function MessageItem({
  msg,
  continuation,
  author,
  forwardedFrom,
  isInThread,
  editingId,
  isSelected,
  isHighlighted,
  onClearEdit,
  onOpenThread,
  onOpenMenu,
}: Props) {
  const stickerMap = useStickerMap()
  const editMutation = useEditMessage(msg.room_id)

  const [editText, setEditText] = useState(msg.content ?? '')
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editingId === msg.id) setEditText(msg.content ?? '')
  }, [editingId, msg.id, msg.content])

  // Поле редактирования растёт под объём текста (в пределах max-height из CSS), чтобы
  // большое сообщение было видно целиком без постоянного скролла вверх-вниз.
  useLayoutEffect(() => {
    if (editingId !== msg.id) return
    const el = editRef.current
    if (!el) return
    el.style.height = 'auto'
    // border-box: добавляем бордеры (offsetHeight - clientHeight), иначе поле ниже
    // контента и скроллбар появляется раньше упора в max-height.
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`
  }, [editText, editingId, msg.id])

  const name = author?.display_name ?? `Участник #${msg.sender_id}`
  const forwardedName =
    msg.forwarded_from_sender_id != null
      ? forwardedFrom?.display_name ?? `Участник #${msg.forwarded_from_sender_id}`
      : null
  const sticker = msg.sticker_id != null ? stickerMap.get(msg.sticker_id) : undefined
  const contentHtml = useMemo(
    () => (msg.content ? renderMarkdown(msg.content) : ''),
    [msg.content],
  )

  const isEditing = editingId === msg.id

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
      onClick={(e) => {
        e.stopPropagation()
        if (!isEditing) onOpenMenu?.(msg, e.currentTarget.getBoundingClientRect())
      }}
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

        {forwardedName && (
          <div className={styles.msgForwarded}>переслано от {forwardedName}</div>
        )}

        {isEditing ? (
          <div className={styles.editRow}>
            <textarea
              ref={editRef}
              className={styles.editInput}
              value={editText}
              autoFocus
              onChange={e => setEditText(e.target.value)}
              onClick={(e) => e.stopPropagation()}
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
            {(msg.attachments?.length ?? msg.attachment_ids.length) > 0 && (
              // Клики по вложениям (play/seek/скорость видео, аудио-плеер, лайтбокс,
              // «Скачать») остаются внутри плеера и не всплывают до onClick пузыря —
              // иначе тап по медиа заодно открывал бы контекстное меню сообщения.
              // Меню по-прежнему доступно тапом по остальной части пузыря.
              <div className={styles.attachments} onClick={(e) => e.stopPropagation()}>
                {/* Новый путь: presigned-URL уже в ленте. Фолбэк на id — для старых
                    сообщений в кэше, где attachments ещё нет. */}
                {msg.attachments?.length
                  ? msg.attachments.map(att => (
                      <Attachment key={att.asset_id} attachment={att} />
                    ))
                  : msg.attachment_ids.map(id => (
                      <Attachment key={id} assetId={id} />
                    ))}
              </div>
            )}

            {msg.sticker_id != null && (
              sticker?.image_url
                ? <img className={styles.sticker} src={sticker.image_url} alt={sticker.keyword ?? ''} />
                : <span className={styles.msgPlaceholder}>[стикер]</span>
            )}

            {msg.content && (
              <div
                className={`${styles.msgText} ${styles.markdown}`}
                dangerouslySetInnerHTML={{ __html: contentHtml }}
              />
            )}
          </>
        )}

        {msg.edited_at && (
          <div className={styles.msgMeta}>изменено</div>
        )}

        {msg.reply_count > 0 && !isInThread && (
          <button
            className={styles.threadLink}
            onClick={(e) => { e.stopPropagation(); onOpenThread?.(msg.id) }}
          >
            Тред · {msg.reply_count}
          </button>
        )}
      </div>
    </div>
  )
}
