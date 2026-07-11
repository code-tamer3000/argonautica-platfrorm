import { useEffect, useRef, useState } from 'react'
import { useMarkRead } from '../../api/messages'
import { useThread } from '../../api/threads'
import { useUsersMap } from '../../api/users'
import { Spinner } from '../../components/Spinner'
import { plural } from '../../lib/format'
import type { MessageOut } from '../../lib/types'
import { MessageActionsMenu } from './MessageActionsMenu'
import { MessageItem } from './MessageItem'
import { useMessageMenu } from './useMessageMenu'
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
}

/**
 * Ветка треда, раскрытая прямо в ленте под корневым сообщением (аккордеон, не drawer).
 * Здесь ТОЛЬКО ответы + кнопки «показать ещё» / «свернуть» (снизу). Ввод ответа — через
 * ОСНОВНОЙ композер чата в режиме треда (Composer.threadRoot): один композер на телефоне
 * и на компе, с вложениями/стикерами/голосом. Ответ уходит в корень (плоский тред,
 * см. docs/MESSAGES.md); открытый тред обновляется по инвалидации thread-query.
 */
export function InlineThread({ roomId, rootId, canPin, isNews, onRepost }: Props) {
  const { data, isLoading } = useThread(roomId, rootId)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [expandedAll, setExpandedAll] = useState(false)
  const users = useUsersMap()
  const markRead = useMarkRead(roomId)
  // Якорь на конце ветки: при открытии треда докручиваем ленту вниз, чтобы сразу
  // видеть последние ответы и композер с полем «Ответить в тред».
  const endRef = useRef<HTMLDivElement>(null)
  const scrolledRef = useRef(false)
  // «Ответить» в меню не показываем — мы уже в треде, ответ уходит в корень через композер.
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

  const replies = data?.replies ?? []
  const hidden = expandedAll ? 0 : Math.max(0, replies.length - PREVIEW_COUNT)
  const shown = hidden > 0 ? replies.slice(-PREVIEW_COUNT) : replies

  // Один раз после первой загрузки ветки — плавно докрутить её конец в область
  // видимости (block:'nearest' — сдвигаем ровно на сколько нужно, без рывка вверх).
  useEffect(() => {
    if (scrolledRef.current || !data) return
    scrolledRef.current = true
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [data])

  // Сжался вьюпорт (открылась/анимируется клавиатура), пока тред раскрыт → держим
  // конец ветки в видимой области, чтобы последние ответы не прятались за клавиатурой.
  // Слушаем visualViewport напрямую: срабатывает и на Android (layout-resize), и на iOS
  // (visual-only). Реагируем только на УМЕНЬШЕНИЕ высоты (открытие), не на закрытие.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let prev = vv.height
    const onResize = () => {
      const shrank = vv.height < prev - 60
      prev = vv.height
      if (shrank) {
        requestAnimationFrame(() =>
          endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
        )
      }
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className={styles.inlineThread}>
      <div className={styles.inlineThreadRail} />
      <div className={styles.inlineThreadBody}>
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
        {/* «Свернуть тред» и поле ответа живут в основном композере снизу
            (контекст-бар «Ответ в тред»), чтобы быть всегда на виду. */}
        <div ref={endRef} />
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
