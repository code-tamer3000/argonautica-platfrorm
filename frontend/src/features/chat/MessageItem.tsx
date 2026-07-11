import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useEditMessage } from '../../api/messages'
import { useStickerMap } from '../../api/stickers'
import { Avatar } from '../../components/Avatar'
import { IconChevronDown } from '../../components/icons'
import { timeHM } from '../../lib/format'
import { renderMarkdown } from '../../lib/markdown'
import { renderMessageText } from '../../lib/messageText'
import { discard as outboxDiscard, retry as outboxRetry } from '../../lib/outbox'
import type { MessageOut, PublicUserOut } from '../../lib/types'
import { Attachment } from './Attachment'
import styles from './chat.module.css'

interface Props {
  msg: MessageOut
  continuation: boolean
  author?: PublicUserOut
  forwardedFrom?: PublicUserOut
  isInThread?: boolean
  // Каналы-дневники рендерят текст как markdown (заголовки/списки/жирный —
  // участники ведут ежедневные записи с оформлением). Личные чаты, группы и
  // новости — простой текст. См. lib/markdown.ts / lib/messageText.tsx.
  markdown?: boolean
  editingId?: number | null
  isSelected?: boolean
  isHighlighted?: boolean
  // Тред этого сообщения сейчас развёрнут инлайн под ним (см. InlineThread).
  threadOpen?: boolean
  onClearEdit?: () => void
  onToggleThread?: (rootId: number) => void
  // Тап по сообщению → открыть контекстное меню действий (позиция = rect сообщения).
  onOpenMenu?: (msg: MessageOut, anchor: DOMRect) => void
}

export function MessageItem({
  msg,
  continuation,
  author,
  forwardedFrom,
  isInThread,
  markdown,
  editingId,
  isSelected,
  isHighlighted,
  threadOpen,
  onClearEdit,
  onToggleThread,
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
  // В каналах-дневниках текст оформляют markdown-ом (заголовки/списки/жирный) —
  // рендерим в санированный HTML. В личных чатах/группах/новостях markdown не
  // используют: там простой текст с сохранёнными переносами, кликабельными «голыми»
  // ссылками и подсветкой @упоминаний (renderMessageText, без dangerouslySetInnerHTML).
  const markdownHtml = useMemo(
    () => (markdown && msg.content ? renderMarkdown(msg.content) : null),
    [markdown, msg.content],
  )
  const contentParts = useMemo(
    () => (!markdown && msg.content ? renderMessageText(msg.content, styles.mention) : null),
    [markdown, msg.content],
  )

  const isEditing = editingId === msg.id
  // Оптимистичное (ещё не отправленное) сообщение из outbox: приглушаем и не даём
  // открыть меню действий — редактировать/удалять нечего, id временный.
  const outbox = msg._outbox
  const isFailed = outbox?.status === 'failed'

  const msgClass = [
    styles.msg,
    continuation ? styles.msgContinuation : '',
    isSelected ? styles.msgSelected : '',
    isHighlighted ? styles.msgHighlighted : '',
    outbox ? styles.msgPending : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={msgClass}
      data-selected={isSelected || undefined}
      onClick={(e) => {
        e.stopPropagation()
        if (!isEditing && !outbox) onOpenMenu?.(msg, e.currentTarget.getBoundingClientRect())
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
              markdownHtml != null ? (
                <div
                  className={`${styles.msgText} ${styles.markdown}`}
                  dangerouslySetInnerHTML={{ __html: markdownHtml }}
                />
              ) : (
                <div className={styles.msgText}>{contentParts}</div>
              )
            )}
          </>
        )}

        {msg.edited_at && (
          <div className={styles.msgMeta}>изменено</div>
        )}

        {outbox && (
          isFailed ? (
            <div className={styles.msgFailed} onClick={(e) => e.stopPropagation()}>
              <span>Не отправлено</span>
              <button className={styles.msgFailedBtn} onClick={() => outboxRetry(outbox.clientId)}>
                Повторить
              </button>
              <button className={styles.msgFailedBtn} onClick={() => outboxDiscard(outbox.clientId)}>
                Удалить
              </button>
            </div>
          ) : (
            <div className={styles.msgMeta}>отправляется…</div>
          )
        )}

        {msg.reply_count > 0 && !isInThread && (
          <button
            className={`${styles.threadLink} ${threadOpen ? styles.threadLinkOpen : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleThread?.(msg.id) }}
            aria-expanded={threadOpen}
          >
            <IconChevronDown size={15} className={styles.threadLinkChevron} />
            {threadOpen ? 'Свернуть' : `Тред · ${msg.reply_count}`}
            {!threadOpen && msg.unread_reply_count > 0 && (
              <span className={styles.threadLinkNew}>{msg.unread_reply_count} новых</span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
