import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { IconChevronDown } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { dayLabel, sameDay } from '../../lib/format'
import type { MessageOut, PublicUserOut, QuotedMessageOut } from '../../lib/types'
import { InlineThread } from './InlineThread'
import { MessageItem } from './MessageItem'
import { useSwipeToReply } from './useSwipeToReply'
import styles from './chat.module.css'

export interface MessageListHandle {
  scrollToMessage: (id: number) => boolean
  isAtBottom: () => boolean
  scrollToBottom: () => void
  // Снять «прилипание к низу»: следующее изменение высоты ленты (например, схлопывание
  // инлайн-треда) не утащит скролл в конец через ResizeObserver-pin. Зовём синхронно
  // ДО того, как высота изменится.
  releaseBottom: () => void
}

interface Props {
  roomId: number
  messages: MessageOut[]
  hasMore: boolean
  loadMore: () => void
  loading: boolean
  users: Map<number, PublicUserOut>
  editingId?: number | null
  selectedMsgId?: number | null
  highlightedMsgId?: number | null
  // Корень, чей тред развёрнут прямо в ленте (аккордеон под сообщением). null → все свёрнуты.
  expandedThreadId?: number | null
  canPin?: boolean
  // Канал-дневник → текст сообщений рендерится как markdown (см. MessageItem).
  markdown?: boolean
  onClearEdit?: () => void
  onToggleThread?: (rootId: number) => void
  onForward?: (msg: MessageOut) => void
  // Меню «Ответить» = цитата (docs/MESSAGES.md «Quotes») — MessageList сам меню не
  // строит (это ChatPane/InlineThread через useMessageMenu), но пробрасывает onQuote
  // ДАЛЬШЕ в InlineThread — там свой независимый useMessageMenu (можно цитировать
  // сообщение, не выходя из открытого треда).
  onQuote?: (msg: MessageOut) => void
  // Клик по плашке цитаты внутри сообщения → скролл/подсветка оригинала.
  onQuoteJump?: (quote: QuotedMessageOut) => void
  onOpenMenu?: (msg: MessageOut, anchor: DOMRect) => void
  onAtBottomChange?: (isBottom: boolean) => void
  // Пользователь поехал вверх по ленте (читает историю) → true; вернулся к низу → false.
  // ChatPane по этому флагу прячет виджет отписки, чтобы он не закрывал чужие сообщения.
  onScrolledUpChange?: (scrolledUp: boolean) => void
  // Свайп влево по сообщению ставит его в цитату — то же действие, что пункт меню
  // «Ответить». undefined/false из родителя (например, у выпускника) — свайп выключен.
  onSwipeReply?: (messageId: number) => void
  swipeEnabled?: boolean
}

export const MessageList = forwardRef<MessageListHandle, Props>(function MessageList(
  { roomId, messages, hasMore, loadMore, loading, users, editingId, selectedMsgId, highlightedMsgId,
    expandedThreadId, canPin, markdown, onClearEdit, onToggleThread, onForward,
    onQuote, onQuoteJump, onOpenMenu, onAtBottomChange, onScrolledUpChange,
    onSwipeReply, swipeEnabled = true },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  // Кнопка «вниз»: показываем, когда лента уехала вверх больше чем на экран.
  const [showScrollDown, setShowScrollDown] = useState(false)
  // «Уехал вверх» считаем по НАПРАВЛЕНИЮ скролла, а не по расстоянию до низа:
  // расстояние меняется само, когда ChatPane по этому же флагу убирает виджет над
  // лентой (область ленты становится выше) — по расстоянию вышла бы автоколебалка
  // спрятал → стало ближе к низу → показал → снова далеко. Направление такой
  // обратной связи не даёт: скролл-события при смене высоты не приходят.
  const scrolledUp = useRef(false)
  const lastScrollTop = useRef(0)
  const count = messages.length

  useSwipeToReply(
    containerRef,
    onSwipeReply ?? (() => {}),
    swipeEnabled && !!onSwipeReply,
  )

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
    scrollToBottom() {
      const el = containerRef.current
      if (!el) return
      el.scrollTop = el.scrollHeight
      lastScrollTop.current = el.scrollTop
      setScrolledUp(false)
      setShowScrollDown(false)
    },
    releaseBottom() {
      atBottom.current = false
    },
  }))

  // Автоскролл вниз при новых сообщениях, если уже были внизу.
  useEffect(() => {
    const el = containerRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [count])

  // Пока мы «внизу», удерживаем ленту у нижней кромки при ЛЮБОМ изменении высоты —
  // содержимого (поздняя декодировка картинок/медиа) ИЛИ самого контейнера (открылась
  // экранная клавиатура → область ленты сжалась). Без этого последнее сообщение
  // прячется за клавиатурой, а лента «подпрыгивает» к сообщению выше.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const pin = () => { if (atBottom.current) el.scrollTop = el.scrollHeight }
    const ro = new ResizeObserver(pin)
    // Контейнер: его высота уменьшается при открытии клавиатуры (Android/interactive-widget).
    ro.observe(el)
    // Дети-обёртки: их высота растёт при декодировке вложений.
    for (const child of Array.from(el.children)) ro.observe(child)
    // iOS: layout viewport клавиатурой не сжимается (ResizeObserver молчит) — ловим
    // сжатие visual viewport напрямую и до-пинниваем ленту к низу.
    const vv = window.visualViewport
    let prevH = vv?.height ?? 0
    const onVv = () => {
      if (!vv) return
      const shrank = vv.height < prevH - 60
      prevH = vv.height
      if (shrank) requestAnimationFrame(pin)
    }
    vv?.addEventListener('resize', onVv)
    return () => {
      ro.disconnect()
      vv?.removeEventListener('resize', onVv)
    }
  }, [count])

  function setScrolledUp(up: boolean) {
    if (scrolledUp.current === up) return
    scrolledUp.current = up
    onScrolledUpChange?.(up)
  }

  function onScroll() {
    const el = containerRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    const wasAtBottom = atBottom.current
    atBottom.current = dist < 80
    if (!wasAtBottom && atBottom.current) onAtBottomChange?.(true)
    else if (wasAtBottom && !atBottom.current) onAtBottomChange?.(false)
    // Вверх — от первого же заметного движения; обратно — только когда вернулись к низу.
    if (el.scrollTop < lastScrollTop.current - 8) setScrolledUp(true)
    else if (dist < 40) setScrolledUp(false)
    lastScrollTop.current = el.scrollTop
    setShowScrollDown(dist > el.clientHeight)
    if (el.scrollTop < 60 && hasMore && !loading) loadMore()
  }

  function scrollDown() {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div
      className={styles.messages}
      ref={containerRef}
      onScroll={onScroll}
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
              markdown={markdown}
              author={users.get(m.sender_id)}
              forwardedFrom={m.forwarded_from_sender_id != null ? users.get(m.forwarded_from_sender_id) : undefined}
              quoteAuthor={m.quote?.sender_id != null ? users.get(m.quote.sender_id) : undefined}
              editingId={editingId}
              isSelected={selectedMsgId === m.id}
              isHighlighted={highlightedMsgId === m.id}
              threadOpen={expandedThreadId === m.id}
              onClearEdit={onClearEdit}
              onToggleThread={onToggleThread}
              onQuote={onQuote}
              onQuoteJump={onQuoteJump}
              onOpenMenu={onOpenMenu}
            />
            {expandedThreadId === m.id && (
              <InlineThread
                roomId={roomId}
                rootId={m.id}
                canPin={canPin}
                markdown={markdown}
                onForward={onForward}
                onQuote={onQuote}
                onQuoteJump={onQuoteJump}
              />
            )}
          </div>
        )
      })}
      {/* Кнопка «в конец ленты». Живёт последним ребёнком самого скроллера и
          прилипает к его нижней кромке (position: sticky) — абсолютное
          позиционирование здесь уехало бы вместе с содержимым. */}
      <div className={styles.scrollDownDock} aria-hidden={!showScrollDown}>
        <button
          type="button"
          className={`${styles.scrollDownBtn} ${showScrollDown ? styles.scrollDownBtnShown : ''}`}
          onClick={scrollDown}
          tabIndex={showScrollDown ? 0 : -1}
          title="К последним сообщениям"
          aria-label="К последним сообщениям"
        >
          <IconChevronDown size={20} />
        </button>
      </div>
    </div>
  )
})
