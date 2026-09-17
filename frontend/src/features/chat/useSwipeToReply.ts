import { useEffect, useRef, type RefObject } from 'react'
import styles from './chat.module.css'

// Свайп влево по сообщению → цитата (Telegram-style «ответить»). Руками на touch-
// событиях, в стиле лайтбоксного свайпа (components/Overlay.tsx) — без библиотек
// жестов (см. CLAUDE.md: никаких новых npm-зависимостей).
//
// Делегирование на СКРОЛЛ-КОНТЕЙНЕР ленты (`.messages`), а не слушатель на каждое
// сообщение: MessageItem — memo, лента длинная, вешать non-passive touchmove на
// каждую строку было бы дорого и пробивало бы memo. Работает и для ответов в
// открытом треде — InlineThread рендерит их внутри того же контейнера.
//
// Узел сдвига = сам `[data-swipe]` (корневой .msg MessageItem), он же несёт
// data-msg-id — второго уровня «row vs swipe target» не нужно (см. MessageItem.tsx).
//
// Значок ↩ — ОДИН общий DOM-узел на контейнер, позиционируемый императивно ПО
// ОРИГИНАЛЬНОЙ (не сдвинутой) кромке сообщения: если бы он был потомком/псевдо-
// элементом .msg, то унаследовал бы тот же transform и уезжал ВМЕСТЕ с сообщением
// вместо того, чтобы остаться в открывающемся зазоре справа.

const SWIPE_THRESHOLD = 56 // px — после этого срабатывает цитата
const SWIPE_MAX = 72 // px — предел визуального сдвига (с сопротивлением дальше)
const AXIS_LOCK = 8 // px — сколько ждём перед тем, как решить ось жеста
const EDGE_GUARD = 24 // px от левого края экрана — не мешать iOS back-swipe
const ICON_GAP = 8 // px отступ значка от исходной (не сдвинутой) кромки сообщения
// Внутри этих элементов свайп не перехватываем — там свои жесты/интеракции
// (плееры, кнопка треда, реакция, ссылка, поле редактирования).
const IGNORE_SELECTOR = 'button, a, video, audio, input, textarea, [contenteditable]'

export function useSwipeToReply(
  containerRef: RefObject<HTMLElement | null>,
  onSwipeReply: (messageId: number) => void,
  enabled = true,
): void {
  // Стабильная ссылка на актуальный колбэк — эффект переустанавливает слушатели
  // только при смене enabled/containerRef, не на каждый ре-рендер родителя.
  const onSwipeReplyRef = useRef(onSwipeReply)
  onSwipeReplyRef.current = onSwipeReply

  useEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) return
    // Только touch-устройства — на десктопе роль свайпа играет кнопка ↩ на hover.
    if (!('ontouchstart' in window)) return

    let el: HTMLElement | null = null
    let iconEl: HTMLDivElement | null = null
    let startX = 0
    let startY = 0
    let axis: 'none' | 'x' | 'y' = 'none'
    let travel = 0
    let suppressClick = false
    let hapticFired = false // один «щелчок» за жест, не на каждый кадр у порога

    function ensureIcon(): HTMLDivElement {
      if (!iconEl) {
        iconEl = document.createElement('div')
        iconEl.className = styles.swipeReplyIcon
        iconEl.textContent = '↩'
        iconEl.setAttribute('aria-hidden', 'true')
        container!.appendChild(iconEl)
      }
      return iconEl
    }

    const reset = () => {
      if (el) {
        el.style.transition = 'transform 160ms var(--ease-out-soft, ease-out)'
        el.style.transform = ''
        const target = el
        const done = () => { target.style.removeProperty('transition'); target.removeEventListener('transitionend', done) }
        el.addEventListener('transitionend', done)
      }
      if (iconEl) iconEl.style.opacity = '0'
      el = null
      axis = 'none'
      travel = 0
      container?.removeEventListener('touchmove', onTouchMove)
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return
      const target = e.target as HTMLElement
      if (target.closest(IGNORE_SELECTOR)) return
      const row = target.closest<HTMLElement>('[data-swipe]')
      if (!row || row.dataset.outbox === 'true') return
      const touch = e.touches[0]
      if (touch.clientX < EDGE_GUARD) return // iOS back-swipe зона
      el = row
      startX = touch.clientX
      startY = touch.clientY
      axis = 'none'
      travel = 0
      suppressClick = false
      hapticFired = false
      container?.addEventListener('touchmove', onTouchMove, { passive: false })
    }

    function onTouchMove(e: TouchEvent) {
      if (!el) return
      const touch = e.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (axis === 'none') {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
        axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x'
        if (axis === 'y') {
          // Вертикаль — отдаём жест нативному скроллу ленты, дальше не мешаем.
          el = null
          container?.removeEventListener('touchmove', onTouchMove)
          return
        }
      }
      // axis === 'x': свайп влево. Вправо — игнор (некуда, «ответить» только влево).
      e.preventDefault()
      const raw = Math.min(0, dx)
      travel = Math.max(-SWIPE_MAX, raw)
      const progress = Math.min(1, -travel / SWIPE_THRESHOLD)
      el.style.transform = `translate3d(${travel}px,0,0)`

      // Значок — по ОРИГИНАЛЬНОЙ кромке: rect уже отражает применённый transform,
      // прибавляем travel обратно (travel отрицателен), чтобы получить положение
      // ДО сдвига, и координаты переводим из viewport в систему прокручиваемого
      // содержимого контейнера (учитывая его текущий scrollTop/scrollLeft).
      const rect = el.getBoundingClientRect()
      const containerRect = container!.getBoundingClientRect()
      const originalRight = rect.right - travel
      const icon = ensureIcon()
      icon.style.left = `${originalRight - containerRect.left + container!.scrollLeft + ICON_GAP}px`
      icon.style.top = `${rect.top - containerRect.top + container!.scrollTop + rect.height / 2}px`
      icon.style.opacity = String(progress)
      icon.style.transform = `translateY(-50%) scale(${0.7 + 0.3 * progress})`

      if (progress >= 1 && !hapticFired) {
        // Момент пересечения порога — лёгкая обратная связь, один раз за жест
        // (нет метода на iOS Safari — просто без хаптика, на этом UX не строим).
        hapticFired = true
        navigator.vibrate?.(10)
      }
    }

    function onTouchEnd() {
      if (!el) return
      const triggered = axis === 'x' && -travel >= SWIPE_THRESHOLD
      const id = Number(el.dataset.msgId)
      reset()
      if (triggered && Number.isFinite(id)) {
        suppressClick = true
        onSwipeReplyRef.current(id)
      }
    }

    // Гасим синтетический клик после свайпа — capture-фаза обязательна: обработчик
    // меню висит на самом .msg (bubbling там опоздал бы).
    function onClickCapture(e: MouseEvent) {
      if (!suppressClick) return
      suppressClick = false
      e.stopPropagation()
      e.preventDefault()
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    container.addEventListener('touchcancel', onTouchEnd, { passive: true })
    container.addEventListener('click', onClickCapture, true)
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
      container.removeEventListener('click', onClickCapture, true)
      iconEl?.remove()
    }
  }, [containerRef, enabled])
}
