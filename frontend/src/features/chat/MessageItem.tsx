import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEditMessage } from '../../api/messages'
import { useToggleReaction } from '../../api/reactions'
import { useStickerMap } from '../../api/stickers'
import { Avatar } from '../../components/Avatar'
import { IconBook, IconChevronDown, IconTasks } from '../../components/icons'
import { timeHM } from '../../lib/format'
import { renderMarkdown } from '../../lib/markdown'
import { renderMessageText } from '../../lib/messageText'
import { discard as outboxDiscard, retry as outboxRetry } from '../../lib/outbox'
import type { MessageOut, PublicUserOut } from '../../lib/types'
import { useAuth } from '../auth/AuthContext'
import { Attachment } from './Attachment'
import { MediaGroup } from './MediaGroup'
import { ReactionChip } from './ReactionChip'
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

// memo: лента перерисовывается на каждое realtime-событие комнаты (typing/presence/
// новое сообщение) и на скролл. MessageItem тяжёлый (markdown, вложения, стикеры),
// поэтому мемоизируем — перерисовываем только те строки, чьи пропсы изменились.
// Требует стабильных колбэков от родителя (см. ChatPane useCallback).
function MessageItemInner({
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
  const toggleReaction = useToggleReaction(msg.room_id)
  const { user } = useAuth()
  // Выпускник реакцию поставить не может — тот же барьер, что и на остальную
  // запись (см. isGraduated в useMessageMenu.tsx). Наблюдатель сюда не попадает:
  // чат для него закрыт целиком на уровне assert_room_access.
  const canReact = !user?.graduated_at
  const navigate = useNavigate()

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
    () => (!markdown && msg.content ? renderMessageText(msg.content, styles.mention, navigate) : null),
    [markdown, msg.content, navigate],
  )

  // Несколько фото/видео в одном сообщении показываем альбомом — одной сеткой, а не
  // столбиком отдельных боксов (MediaGroup). В сетку идут только «плиточные» вложения:
  // картинки и видео, у которых есть что показать. Видео с провалившимся транскодом,
  // голосовые и файлы остаются отдельными блоками под альбомом — там кнопка/плеер,
  // а не кадр. Одиночное вложение альбомом не становится: у него свои пропорции и
  // нативный плеер (см. Attachment.tsx).
  const { tiles, loose } = useMemo(() => {
    const list = msg.attachments ?? []
    const tiles = list.filter(
      (att) =>
        att.kind === 'image' ||
        (att.kind === 'video' && att.transcode_status !== 'failed'),
    )
    if (tiles.length < 2) return { tiles: [], loose: list }
    const tileIds = new Set(tiles.map((att) => att.asset_id))
    return { tiles, loose: list.filter((att) => !tileIds.has(att.asset_id)) }
  }, [msg.attachments])

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
                {tiles.length > 0 && <MediaGroup items={tiles} />}
                {msg.attachments?.length
                  ? loose.map(att => (
                      <Attachment key={att.asset_id} attachment={att} />
                    ))
                  : msg.attachment_ids.map(id => (
                      <Attachment key={id} assetId={id} />
                    ))}
              </div>
            )}

            {/* Полоса заливки вложений в MinIO, пока сообщение ещё pending. Показываем
                только когда прогресс реально идёт (не failed, доля задана) — иначе для
                мелких/мгновенных файлов не мигаем полосой. */}
            {outbox && !isFailed && outbox.uploadProgress != null && (
              <div className={styles.uploadProgress} aria-hidden="true">
                <div className={styles.uploadBar}>
                  <div
                    className={styles.uploadBarFill}
                    style={{ transform: `scaleX(${outbox.uploadProgress})` }}
                  />
                </div>
                <span className={styles.uploadPct}>
                  {Math.round(outbox.uploadProgress * 100)}%
                </span>
              </div>
            )}

            {msg.sticker_id != null && (
              sticker?.image_url
                ? <img className={styles.sticker} src={sticker.image_url} alt={sticker.keyword ?? ''} />
                : <span className={styles.msgPlaceholder}>[стикер]</span>
            )}

            {msg.ref && (
              // Ссылка на материал/задачу — кнопка перед текстом. Недоступную зрителю
              // цель (черновик / чужая задача / удалённая) не даём открыть.
              <button
                className={`${styles.refLink} ${!msg.ref.available ? styles.refLinkDisabled : ''}`}
                disabled={!msg.ref.available}
                onClick={(e) => {
                  e.stopPropagation()
                  if (msg.ref?.available) navigate(msg.ref.url)
                }}
              >
                {msg.ref.kind === 'kb' ? <IconBook size={16} /> : <IconTasks size={16} />}
                <span className={styles.refLinkText}>
                  {msg.ref.available
                    ? `Перейти к ${msg.ref.kind === 'kb' ? 'материалу' : 'задаче'}: ${msg.ref.title}`
                    : `${msg.ref.kind === 'kb' ? 'Материал' : 'Задача'} недоступен`}
                </span>
              </button>
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

            <ReactionChip
              count={msg.reaction_count}
              reactedByMe={msg.reacted_by_me}
              disabled={!canReact}
              onToggle={() => toggleReaction.mutate(msg)}
            />
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

// Shallow-сравнение пропсов достаточно: msg/author/forwardedFrom — ссылки из
// мемоизированных структур (useMessages flat, useUsersMap), колбэки стабильны
// (useCallback у родителя), остальное — примитивы.
export const MessageItem = memo(MessageItemInner)
